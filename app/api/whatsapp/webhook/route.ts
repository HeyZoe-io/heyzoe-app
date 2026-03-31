import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  verifyTwilioSignature,
  parseTwilioWebhook,
  sendWhatsAppMessage,
  sendWhatsAppMediaMessage,
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
} from "@/lib/whatsapp";
import { getBusinessKnowledgePack, buildSystemPrompt } from "@/lib/business-context";
import { CLAUDE_CHAT_MODEL, CLAUDE_MAX_TOKENS, resolveClaudeApiKey, formatUserFacingClaudeError } from "@/lib/claude";
import { logMessage } from "@/lib/analytics";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// In-process dedup: prevents double-processing when Twilio retries the webhook
const processedMessageIds = new Set<string>();

// ─── POST — incoming messages from Twilio ─────────────────────────────────────

export async function POST(req: NextRequest) {
  const accountSid = resolveTwilioAccountSid();
  const authToken  = resolveTwilioAuthToken();

  // Parse form-encoded body
  const rawBody = await req.text();
  const params  = Object.fromEntries(new URLSearchParams(rawBody));

  // Reconstruct the public URL — req.url on Vercel is an internal address.
  // Twilio signs using the exact URL configured in its console.
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const signingUrl = `${proto}://${host}/api/whatsapp/webhook`;
  console.log("[WA Webhook] signing URL:", signingUrl, "| req.url:", req.url);

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

  // Return 200 immediately — Twilio expects a fast response
  // Process the message (awaited — webhook keeps connection open for up to 10s)
  const msg = parseTwilioWebhook(params);
  if (msg) {
    await processIncoming(msg, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] processIncoming error:", e)
    );
  }

  // Twilio expects empty 200 (or TwiML) — we use empty 200
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
    .select("business_slug, phone_number_id")
    .eq("phone_number_id", msg.toNumber)
    .eq("is_active", true)
    .maybeSingle();

  if (!channel) {
    console.warn(`[WA Webhook] No active channel for number: ${msg.toNumber}`);
    return;
  }

  const { business_slug } = channel;
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
  if (isNewLead) {
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

    const bizName = knowledge?.businessName?.trim() || business_slug;
    const address = knowledge?.addressText?.trim();
    const services = knowledge?.servicesShortText?.trim();
    const sportName = (knowledge?.niche?.trim() || "האימון").replace(/\s+/g, " ");

    const openingLines: string[] = [];
    openingLines.push(`היי! כאן ${bizName}.`);
    if (address) openingLines.push(`כתובת: ${address}`);
    if (services) {
      openingLines.push(`שירותים ומחירים:`);
      openingLines.push(services);
    }
    openingLines.push(`האם יצא לך לנסות ${sportName} בעבר?`);
    openingLines.push(`1. לא יצא לי`);
    openingLines.push(`2. יצא לי פעם-פעמיים`);
    openingLines.push(`3. יצא לי לא מעט פעמים`);
    openingLines.push(`\n(אפשר לענות רק עם 1/2/3)`);

    const openingText = openingLines.join("\n");

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

  const OTHER_LABEL = "שאלה אחרת";

  // ── Quick-reply vs. "other question" routing ────────────────────────────────
  const incomingRaw = msg.text.trim();
  const incomingNorm = incomingRaw.toLowerCase();

  const matched = knowledge?.quickReplies?.find(
    (qr) => qr.label.trim().toLowerCase() === incomingNorm
  );

  let replyCore: string;

  if (matched && matched.reply) {
    // Static answer for a predefined quick-reply button
    replyCore = matched.reply;
    console.info(`[WA Webhook] Quick-reply match: "${matched.label}" → static response`);
  } else {
    // "שאלה אחרת" or any free-form question → Claude
    const systemPrompt = buildSystemPrompt(knowledge, business_slug, "whatsapp");
    const client = new Anthropic({ apiKey: claudeApiKey });
    try {
      const response = await client.messages.create({
        model: CLAUDE_CHAT_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: msg.text }],
      });
      replyCore =
        response.content[0]?.type === "text"
          ? response.content[0].text.trim()
          : formatUserFacingClaudeError(new Error("empty response"));
    } catch (e) {
      console.error(`[WA Webhook] Claude error for ${business_slug}:`, e);
      replyCore = formatUserFacingClaudeError(e);
    }
  }

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

  let replyText = replyCore;

  // Append CTA if available
  const ctaText = knowledge?.ctaText?.trim();
  const ctaLink = knowledge?.ctaLink?.trim();
  if (ctaText && ctaLink) {
    replyText += `\n\n${ctaText}: ${ctaLink}`;
  }

  // Append buttons and small footer note
  replyText += buttonsBlock;
  replyText += `\n\nניתן לכתוב לנו גם שאלה שאינה מופיעה`;

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
    model_used: matched?.reply ? "static" : CLAUDE_CHAT_MODEL,
    session_id: sessionId,
  });
}
