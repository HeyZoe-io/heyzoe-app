import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  verifyTwilioSignature,
  parseTwilioWebhook,
  parseMetaWebhook,
  explainMetaWebhookSkip,
  sendWhatsAppMessage,
  sendWhatsAppMediaMessage,
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
  resolveMetaAppSecret,
  resolveMetaVerifyToken,
  verifyMetaSignature256,
} from "@/lib/whatsapp";
import { getBusinessKnowledgePack, buildSystemPrompt } from "@/lib/business-context";
import { formatWhatsAppOpeningText } from "@/lib/whatsapp-opening";
import { fillAfterServicePickTemplate } from "@/lib/sales-flow";
import {
  CLAUDE_WHATSAPP_MODEL,
  CLAUDE_WHATSAPP_MAX_TOKENS,
  resolveClaudeApiKey,
  formatUserFacingClaudeError,
  isRetryableClaudeError,
  sleepMs,
} from "@/lib/claude";
import { extractErrorCode, fetchRecentSessionMessages, logMessage } from "@/lib/analytics";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// In-process dedup: prevents double-processing when Twilio retries the webhook
const processedMessageIds = new Set<string>();

// ─── GET — Meta webhook verification ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode") ?? "";
  const token = sp.get("hub.verify_token") ?? "";
  const challenge = sp.get("hub.challenge") ?? "";
  const expected = resolveMetaVerifyToken();
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Unauthorized", { status: 401 });
}

// ─── POST — incoming messages from Twilio or Meta ─────────────────────────────

export async function POST(req: NextRequest) {
  const accountSid = resolveTwilioAccountSid();
  const authToken  = resolveTwilioAuthToken();

  const rawBody = await req.text();

  // Reconstruct the public URL — req.url on Vercel is an internal address.
  // Twilio signs using the exact URL configured in its console.
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const signingUrl = `${proto}://${host}/api/whatsapp/webhook`;
  console.log("[WA Webhook] signing URL:", signingUrl, "| req.url:", req.url);

  // Meta sends JSON; Twilio sends form-urlencoded. Detect via parsed object (substring match missed some payloads).
  const rawStripped = rawBody.replace(/^\uFEFF/, "");
  const trimmedBody = rawStripped.trim();
  let metaPayload: Record<string, unknown> | null = null;
  if (trimmedBody.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmedBody);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { object?: string }).object === "whatsapp_business_account"
      ) {
        metaPayload = parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON — treat as Twilio form body below.
    }
  }

  let msg: ReturnType<typeof parseTwilioWebhook> | ReturnType<typeof parseMetaWebhook> | null = null;

  if (metaPayload) {
    const maxLog = 8192;
    const bodyForLog =
      rawStripped.length > maxLog
        ? `${rawStripped.slice(0, maxLog)}… (${rawStripped.length} bytes total)`
        : rawStripped;
    console.log("[WA Webhook] Meta raw body:", bodyForLog);

    const appSecret = resolveMetaAppSecret();
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    if (appSecret) {
      if (!verifyMetaSignature256(appSecret, sig, rawBody)) {
        console.warn("[WA Webhook] Invalid Meta signature — rejected");
        return new Response("Unauthorized", { status: 401 });
      }
    } else {
      console.warn(
        "[WA Webhook] WHATSAPP_APP_SECRET (or META_APP_SECRET) missing — skipping Meta signature verification"
      );
    }
    msg = parseMetaWebhook(metaPayload);
    if (!msg) {
      console.warn("[WA Webhook] parseMetaWebhook: no inbound message —", explainMetaWebhookSkip(metaPayload));
    }
  } else {
    if (trimmedBody.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmedBody);
        if (parsed && typeof parsed === "object") {
          console.warn("[WA Webhook] JSON POST is not Meta WABA webhook; ignoring.", {
            object: (parsed as { object?: string }).object,
          });
          return new Response("", { status: 200 });
        }
      } catch {
        console.warn(
          "[WA Webhook] Body starts with { but JSON.parse failed; attempting Twilio form parser"
        );
      }
    }

    // Twilio: Parse form-encoded body
    const params = Object.fromEntries(new URLSearchParams(rawBody));

    // Verify Twilio signature (skip in dev if auth token not set)
    if (authToken) {
      const signature = req.headers.get("x-twilio-signature") ?? "";
      const sortedParamKeys = Object.keys(params).sort();
      const paramStr = sortedParamKeys.map(k => `${k}=${params[k]}`).join(" | ");
      const { createHmac } = await import("crypto");
      const strToSign = signingUrl + sortedParamKeys.map(k => k + (params[k] ?? "")).join("");
      const computed = createHmac("sha1", authToken).update(strToSign, "utf8").digest("base64");
      console.log("[WA Webhook] signature debug:", {
        signingUrl,
        receivedSig: signature,
        computedSig: computed,
        match: computed === signature,
        paramKeys: sortedParamKeys,
        paramStr,
      });
      if (!verifyTwilioSignature(authToken, signature, signingUrl, params)) {
        console.warn("[WA Webhook] Invalid Twilio signature — rejected");
        return new Response("Unauthorized", { status: 401 });
      }
    }
    msg = parseTwilioWebhook(params);
  }

  // Process the message (awaited — webhook keeps connection open for up to 10s)
  if (msg) {
    await processIncoming(msg, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] processIncoming error:", e)
    );
  }

  // Meta expects 200 quickly as well.
  return new Response("", { status: 200 });
}

// ─── Core processing ──────────────────────────────────────────────────────────

async function processIncoming(
  msg: ReturnType<typeof parseTwilioWebhook> & object,
  accountSid: string,
  authToken: string
): Promise<void> {
  // Dedup
  if (processedMessageIds.has(msg.messageId)) {
    console.info(`[WA Webhook] Skipping duplicate ${msg.messageId}`);
    return;
  }
  processedMessageIds.add(msg.messageId);
  if (processedMessageIds.size > 10_000) {
    const first = processedMessageIds.values().next().value;
    if (first) processedMessageIds.delete(first);
  }

  const claudeApiKey = resolveClaudeApiKey();
  if (!claudeApiKey) {
    console.error("[WA Webhook] Missing ANTHROPIC_API_KEY");
    return;
  }

  const supabase = createSupabaseAdminClient();

  // Route: look up business by Twilio "To" number
  const { data: channel } = await supabase
    .from("whatsapp_channels")
    .select("business_slug, business_id, phone_number_id")
    .eq("phone_number_id", msg.toNumber)
    .eq("is_active", true)
    .maybeSingle();

  if (!channel) {
    console.warn(`[WA Webhook] No active channel for number: ${msg.toNumber}`);
    return;
  }

  const { business_slug } = channel;

  const nowIso = new Date().toISOString();

  // Resolve business_id (needed for contacts upsert)
  let businessId: string | null = (channel as any).business_id ?? null;
  if (!businessId) {
    try {
      const { data: biz } = await supabase
        .from("businesses")
        .select("id")
        .eq("slug", business_slug)
        .maybeSingle();
      businessId = (biz as any)?.id ?? null;
    } catch (e) {
      console.warn("[WA Webhook] failed to resolve business_id (continuing):", e);
      businessId = null;
    }
  }

  // ── SAVE CONTACT (upsert) + OPT-IN/OPT-OUT gating ───────────────────────────
  // Always try to save/update the contact on any inbound message.
  // If contact is opted out, we may early-return before reaching any automated flow.
  let contactOptedOut: boolean | null = null;
  let contactClaudeCount: number | null = null;
  if (businessId) {
    try {
      const phone = msg.from;
      const fullName =
        typeof (msg as any).profileName === "string" ? (msg as any).profileName.trim() : "";

      const upsertPayload: Record<string, unknown> = {
        phone,
        business_id: businessId,
        source: "whatsapp",
        last_contact_at: nowIso,
      };
      if (fullName) upsertPayload.full_name = fullName;

      // Select `claude_message_count` if the column exists; fall back gracefully otherwise.
      let contactRow: any = null;
      let upsertErr: any = null;
      try {
        const r = await supabase
          .from("contacts")
          .upsert(upsertPayload, { onConflict: "business_id,phone" })
          .select("opted_out, claude_message_count")
          .maybeSingle();
        contactRow = r.data;
        upsertErr = r.error;
      } catch {
        const r = await supabase
          .from("contacts")
          .upsert(upsertPayload, { onConflict: "business_id,phone" })
          .select("opted_out")
          .maybeSingle();
        contactRow = r.data;
        upsertErr = r.error;
      }

      if (upsertErr) {
        console.warn("[WA Webhook] contacts upsert failed (continuing):", upsertErr);
      }

      contactOptedOut =
        typeof (contactRow as any)?.opted_out === "boolean" ? (contactRow as any).opted_out : null;
      const cc = (contactRow as any)?.claude_message_count;
      contactClaudeCount = typeof cc === "number" && Number.isFinite(cc) ? cc : null;
    } catch (e) {
      console.warn("[WA Webhook] contacts upsert threw (continuing):", e);
    }
  } else {
    console.warn("[WA Webhook] missing business_id; skipping contacts upsert");
  }

  // Helper: normalize inbound text for matching
  const incomingTextRaw = msg.type === "text" ? msg.text : "";
  const incomingText = incomingTextRaw.trim().toLowerCase();

  const matchesAny = (hay: string, needles: string[]) => {
    const h = hay.trim().toLowerCase();
    if (!h) return false;
    return needles.some((n) => h === n || h.includes(n));
  };

  const OPT_OUT = [
    "הסר",
    "הסרה",
    "הפסק",
    "בטל",
    "לא רוצה",
    "לא מעוניין",
    "עצור",
    "stop",
    "unsubscribe",
    "remove",
    "cancel",
    "opt out",
    "optout",
  ];
  const OPT_IN = [
    "הצטרף",
    "כן",
    "חזור",
    "רוצה לקבל",
    "start",
    "join",
    "subscribe",
    "yes",
  ];

  let optedInThisMessage = false;

  // 2) OPT-OUT DETECTION (only for text)
  if (msg.type === "text" && matchesAny(incomingText, OPT_OUT)) {
    if (businessId) {
      await supabase
        .from("contacts")
        .update({ opted_out: true, opted_out_at: nowIso })
        .eq("business_id", businessId)
        .eq("phone", msg.from);
    }
    await sendWhatsAppMessage(
      msg.toNumber,
      msg.from,
      "הוסרת בהצלחה מרשימת ההתראות ✅\nאם תרצה לחזור בעתיד, פשוט שלח *הצטרף*",
      accountSid,
      authToken
    ).catch((e) => console.error("[WA Webhook] Send opt-out reply failed:", e));
    return;
  }

  // 3) OPT-IN DETECTION (for users who previously opted out)
  if (msg.type === "text" && contactOptedOut === true && matchesAny(incomingText, OPT_IN)) {
    if (businessId) {
      await supabase
        .from("contacts")
        .update({ opted_out: false, opted_in_at: nowIso, opted_out_at: null })
        .eq("business_id", businessId)
        .eq("phone", msg.from);
    }
    await sendWhatsAppMessage(
      msg.toNumber,
      msg.from,
      "ברוך שובך! 🎉 נשמח לעדכן אותך שוב בהמשך",
      accountSid,
      authToken
    ).catch((e) => console.error("[WA Webhook] Send opt-in reply failed:", e));
    // Continue to Zoe normally (don't early-return)
    contactOptedOut = false;
    optedInThisMessage = true;
  }

  // 1) If currently opted out, do not pass to Zoe (or any automated flow)
  if (contactOptedOut === true) {
    await sendWhatsAppMessage(
      msg.toNumber,
      msg.from,
      "שלום! כרגע הסרת את עצמך מרשימת ההתראות שלנו. אם תרצה לחזור שלח *הצטרף* או *כן*",
      accountSid,
      authToken
    ).catch((e) => console.error("[WA Webhook] Send opted-out gating reply failed:", e));
    return;
  }

  const sessionId = `wa_${msg.toNumber}_${msg.from}`;

  // Detect "new lead" (first message in this session)
  let isNewLead = false;
  try {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true } as any)
      .eq("business_slug", business_slug)
      .eq("session_id", sessionId);
    isNewLead = (count ?? 0) === 0;
  } catch (e) {
    console.warn("[WA Webhook] new-lead check failed (continuing):", e);
  }

  // Handle unsupported message types
  if (msg.type === "unsupported") {
    await sendWhatsAppMessage(
      msg.toNumber,
      msg.from,
      "שלום! אני מטפלת בהודעות טקסט בלבד. שלחו לי שאלה בכתב ואשמח לעזור 😊",
      accountSid,
      authToken
    ).catch((e) => console.error("[WA Webhook] Send unsupported reply failed:", e));
    return;
  }

  // Log user message
  await logMessage({
    business_slug,
    role: "user",
    content: msg.text,
    session_id: sessionId,
  });

  // Check if this session is currently paused (manual takeover by human).
  try {
    const nowIso = new Date().toISOString();
    const { data: paused } = await supabase
      .from("paused_sessions")
      .select("id, paused_until")
      .eq("business_slug", business_slug)
      .eq("session_id", sessionId)
      .gt("paused_until", nowIso)
      .maybeSingle();
    if (paused) {
      console.info(
        `[WA Webhook] Session ${sessionId} for ${business_slug} is paused until ${paused.paused_until}; skipping auto-reply.`
      );
      return;
    }
  } catch (e) {
    console.error("[WA Webhook] pause-check failed (continuing anyway):", e);
  }

  // Build context
  const knowledge = await getBusinessKnowledgePack(business_slug);

  // New lead flow: optional media first, then a default opening message (no AI)
  // If the user just opted back in, continue to Zoe instead of stopping on default opening.
  if (isNewLead && !optedInThisMessage) {
    try {
      const mediaUrl = knowledge?.openingMediaUrl?.trim() ?? "";
      if (mediaUrl) {
        await sendWhatsAppMediaMessage(msg.toNumber, msg.from, mediaUrl, accountSid, authToken);
        await logMessage({
          business_slug,
          role: "assistant",
          content: `[media] ${mediaUrl}`,
          model_used: "opening_media",
          session_id: sessionId,
        });
      }
    } catch (e) {
      console.error("[WA Webhook] sending opening media failed (continuing):", e);
    }

    const openingText = knowledge
      ? formatWhatsAppOpeningText(knowledge)
      : `היי! כאן ${business_slug}.\nאשמח לעזור — שלחו שאלה בקצרה.`;

    try {
      await sendWhatsAppMessage(msg.toNumber, msg.from, openingText, accountSid, authToken);
    } catch (e) {
      console.error(`[WA Webhook] Send opening message failed to ${msg.from}:`, e);
    }

    await logMessage({
      business_slug,
      role: "assistant",
      content: openingText,
      model_used: "default_opening",
      session_id: sessionId,
    });

    return;
  }

  // ───────────────────── Priority routing (no Claude first) ───────────────────
  // 0) Greeting messages (deterministic) — don't send to Claude.
  if (msg.type === "text") {
    const greet = msg.text.trim().toLowerCase().replace(/\s+/g, " ");
    const GREETINGS = new Set(["שלום", "היי", "הי", "hello", "hi"]);
    if (GREETINGS.has(greet)) {
      // Treat greetings as a "reset" — send the full opening message (intro + question + options)
      // even if this contact talked before.
      const out = knowledge
        ? formatWhatsAppOpeningText(knowledge)
        : `היי! כאן ${business_slug}.\nאשמח לעזור — שלחו שאלה בקצרה.`;

      await sendWhatsAppMessage(msg.toNumber, msg.from, out, accountSid, authToken).catch((e) =>
        console.error("[WA Webhook] Send greeting reply failed:", e)
      );
      await logMessage({
        business_slug,
        role: "assistant",
        content: out,
        model_used: "greeting",
        session_id: sessionId,
      });
      return;
    }
  }

  // 1) FAQ exact-ish match (dashboard data)
  if (msg.type === "text" && businessId) {
    try {
      const { data: faqs } = await supabase
        .from("faqs")
        .select("question, answer")
        .eq("business_id", Number(businessId))
        .order("sort_order", { ascending: true })
        .limit(40);

      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const inTxt = norm(msg.text);
      const hit = (faqs ?? []).find((f: any) => {
        const q = norm(String(f.question ?? ""));
        if (!q) return false;
        // exact or includes (either direction) to handle short questions
        if (inTxt === q) return true;
        if (q.length >= 6 && inTxt.includes(q)) return true;
        if (inTxt.length >= 8 && q.includes(inTxt)) return true;
        return false;
      });

      const ans = hit ? String((hit as any).answer ?? "").trim() : "";
      if (ans) {
        await sendWhatsAppMessage(msg.toNumber, msg.from, ans, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send FAQ reply failed:", e)
        );
        await logMessage({
          business_slug,
          role: "assistant",
          content: ans,
          model_used: "faq",
          session_id: sessionId,
        });
        return;
      }
    } catch (e) {
      console.warn("[WA Webhook] FAQ lookup failed (continuing):", e);
    }
  }

  // 2) Sales flow step: service pick → after_pick + experience question (dashboard config)
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId) {
    try {
      const { data: services } = await supabase
        .from("services")
        .select("name, description, service_slug")
        .eq("business_id", Number(businessId))
        .order("created_at", { ascending: true })
        .limit(24);

      const named = (services ?? [])
        .map((s: any) => ({
          name: String(s.name ?? "").trim(),
          benefit: (() => {
            try {
              const raw = String(s.description ?? "");
              const meta = JSON.parse(raw || "{}") as Record<string, unknown>;
              return String(meta.benefit_line ?? "").trim();
            } catch {
              return "";
            }
          })(),
        }))
        .filter((s: any) => s.name);

      if (named.length > 1) {
        const raw = msg.text.trim();
        const rawLower = raw.toLowerCase();
        const num = Number(rawLower);
        const picked =
          Number.isFinite(num) && num >= 1 && num <= named.length
            ? named[num - 1]
            : named.find((s: any) => s.name.toLowerCase() === rawLower) ??
              named.find((s: any) => rawLower && s.name.toLowerCase().includes(rawLower));

        if (picked) {
          const cfg = knowledge.salesFlowConfig;
          const afterPick = fillAfterServicePickTemplate(
            cfg.after_service_pick,
            picked.name,
            picked.benefit
          );
          const q = String(cfg.experience_question ?? "").replace(/\{serviceName\}/g, picked.name);
          const opts = Array.isArray(cfg.experience_options) ? cfg.experience_options : [];

          const outLines = [afterPick, "", q, ...opts, "", "ניתן לבחור לפי אחת מהאפשרויות למעלה או לכתוב בקצרה."];
          const out = outLines.filter((x) => x !== undefined).join("\n").trim();

          await sendWhatsAppMessage(msg.toNumber, msg.from, out, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send sales-flow pick reply failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: out,
            model_used: "sales_flow",
            session_id: sessionId,
          });
          return;
        }
      }
    } catch (e) {
      console.warn("[WA Webhook] Sales-flow match failed (continuing):", e);
    }
  }

  const OTHER_LABEL = "שאלה אחרת";

  // ── Quick-reply vs. "other question" routing ────────────────────────────────
  const incomingRaw = msg.text.trim();
  const incomingNorm = incomingRaw.toLowerCase();

  const quickLabels = (knowledge?.quickReplies ?? [])
    .map((qr) => qr.label.trim())
    .filter((lbl) => lbl.length > 0);
  const buttons: string[] = [...quickLabels, OTHER_LABEL];

  // Allow numeric answers (1/2/3...) to map to the displayed buttons list.
  let incomingAsLabel = incomingRaw;
  const asNum = Number(incomingNorm);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= buttons.length) {
    incomingAsLabel = buttons[asNum - 1] ?? incomingRaw;
  }

  const matched = knowledge?.quickReplies?.find(
    (qr) => qr.label.trim().toLowerCase() === incomingAsLabel.trim().toLowerCase()
  );

  let replyCore: string;
  let replyErrorCode: string | null = null;
  let isFallbackErrorReply = false;
  let didCallClaude = false;

  if (matched && matched.reply) {
    // Static answer for a predefined quick-reply button
    replyCore = matched.reply;
    console.info(`[WA Webhook] Quick-reply match: "${matched.label}" → static response`);
  } else {
    // Claude rate limiting per contact (phone+business)
    if (contactClaudeCount != null && contactClaudeCount >= 20) {
      const txt =
        'נראה שיש לך שאלות נוספות 😊 כדי שנוכל לעזור לך בצורה\nהטובה ביותר, מומלץ לדבר ישירות עם הצוות שלנו.\nנשמח לחזור אליך בהקדם!';
      await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
        console.error("[WA Webhook] Send claude-limit reply failed:", e)
      );
      await logMessage({
        business_slug,
        role: "assistant",
        content: txt,
        model_used: "claude_limit",
        session_id: sessionId,
        error_code: "claude_limit",
      });
      return;
    }

    // "שאלה אחרת" or any free-form question → Claude (עם היסטוריית סשן כדי להמשיך פלואו מכירה)
    const systemPrompt = buildSystemPrompt(knowledge, business_slug, "whatsapp");
    const history = await fetchRecentSessionMessages({
      business_slug,
      session_id: sessionId,
      limit: 28,
    });
    const claudeMessages =
      history.length > 0
        ? history.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: "user" as const, content: msg.text }];
    const client = new Anthropic({ apiKey: claudeApiKey });
    try {
      didCallClaude = true;
      const runClaude = async () =>
        client.messages.create({
          model: CLAUDE_WHATSAPP_MODEL,
          max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
          system: systemPrompt,
          messages: claudeMessages,
        });

      let response: Awaited<ReturnType<typeof runClaude>> | null = null;
      try {
        response = await runClaude();
      } catch (e) {
        // One quick retry on transient errors (Twilio webhook must stay fast)
        if (isRetryableClaudeError(e)) {
          await sleepMs(900);
          response = await runClaude();
        } else {
          throw e;
        }
      }

      const extractCombinedText = (resObj: any) => {
        const textBlocks =
          Array.isArray(resObj?.content)
            ? resObj.content
                .filter(
                  (b: any) =>
                    b && typeof b === "object" && b.type === "text" && typeof b.text === "string"
                )
                .map((b: any) => String(b.text).trim())
                .filter(Boolean)
            : [];
        return textBlocks.join("\n").trim();
      };

      // Some rare Anthropic responses return end_turn with empty content.
      // Retry once even if no error was thrown.
      let combinedText = extractCombinedText(response as any);
      if (!combinedText) {
        await sleepMs(700);
        const retryResp = await runClaude();
        combinedText = extractCombinedText(retryResp as any);
        response = retryResp;
      }

      replyCore = combinedText || formatUserFacingClaudeError(new Error("empty response"));
      if (!combinedText) {
        isFallbackErrorReply = true;
        const types =
          Array.isArray((response as any)?.content)
            ? (response as any).content.map((b: any) => String(b?.type ?? "unknown")).join(",")
            : "no_content";
        const stopReason = String((response as any)?.stop_reason ?? "");
        const model = String((response as any)?.model ?? "");
        const id = String((response as any)?.id ?? "");
        console.warn("[WA Webhook] Claude empty_response", { id, model, stopReason, types });
        replyErrorCode = replyErrorCode ?? "empty_response";
      }
    } catch (e) {
      console.error(`[WA Webhook] Claude error for ${business_slug}:`, e);
      replyCore = formatUserFacingClaudeError(e);
      replyErrorCode = extractErrorCode(e);
      isFallbackErrorReply = true;
      replyErrorCode = replyErrorCode ?? "claude_failed";
    }
  }

  let replyText = replyCore;

  // If Claude failed and we sent a generic error, don't append menus/CTAs (keeps message clean).
  if (!isFallbackErrorReply) {
    // Build interactive-style menu from quick replies + "other question"
    const quickLabels = (knowledge?.quickReplies ?? [])
      .map((qr) => qr.label.trim())
      .filter((lbl) => lbl.length > 0);
    const buttons: string[] = [...quickLabels, OTHER_LABEL];

    const buttonsBlock =
      buttons.length > 0
        ? `\n\nבחרו אחת מהאפשרויות:\n${buttons
            .map((lbl, idx) => `${idx + 1}. ${lbl}`)
            .join("\n")}`
        : "";

    // Append CTA if available
    const ctaText = knowledge?.ctaText?.trim();
    const ctaLink = knowledge?.ctaLink?.trim();
    if (ctaText && ctaLink) {
      replyText += `\n\n${ctaText}: ${ctaLink}`;
    }

    // Append buttons and small footer note
    replyText += buttonsBlock;
    replyText += `\n\nניתן לכתוב לנו גם שאלה שאינה מופיעה`;
  }

  // Send reply via Twilio
  try {
    await sendWhatsAppMessage(msg.toNumber, msg.from, replyText, accountSid, authToken);
  } catch (e) {
    console.error(`[WA Webhook] Send failed to ${msg.from}:`, e);
  }

  // Log assistant reply
  await logMessage({
    business_slug,
    role: "assistant",
    content: replyText,
    model_used: matched?.reply ? "static" : CLAUDE_WHATSAPP_MODEL,
    session_id: sessionId,
    error_code: replyErrorCode,
  });

  // Increment Claude usage counter (only when Claude was called and we did not fall back).
  if (didCallClaude && businessId && !isFallbackErrorReply) {
    try {
      await supabase
        .from("contacts")
        .update({ claude_message_count: (contactClaudeCount ?? 0) + 1 })
        .eq("business_id", Number(businessId))
        .eq("phone", msg.from);
    } catch (e) {
      console.warn("[WA Webhook] claude_message_count update failed (continuing):", e);
    }
  }
}
