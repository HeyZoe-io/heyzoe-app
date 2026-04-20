import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  verifyTwilioSignature,
  parseTwilioWebhook,
  parseMetaWebhook,
  explainMetaWebhookSkip,
  sendWhatsAppMessage,
  sendWhatsAppTextOrMenu,
  sendWhatsAppMediaMessage,
  resolveMetaInteractiveLabel,
  stripNumberedChoiceLinesAnywhere,
  stripTrailingNumberedChoiceLines,
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
  resolveMetaAppSecret,
  resolveMetaVerifyToken,
  verifyMetaSignature256,
  type WaIncomingMessage,
} from "@/lib/whatsapp";
import { getBusinessKnowledgePack, buildSystemPrompt, type BusinessKnowledgePack } from "@/lib/business-context";
import { getWhatsAppOpeningBodyAndMenuLabels } from "@/lib/whatsapp-opening";
import { ZOE_WHATSAPP_MENU_FOOTER } from "@/lib/whatsapp-copy";
import {
  composeGreeting,
  defaultSalesFlowConfig,
  fillAfterExperienceTemplate,
  fillAfterServicePickTemplate,
  fillCtaBodyTemplate,
  formatAfterTrialRegistrationForWhatsAppDelivery,
  matchesTrialRegisteredMessage,
  type SalesFlowCtaButton,
} from "@/lib/sales-flow";

const TRIAL_LINK_POST_CTA_MESSAGE =
  "לאחר ההרשמה, נא לכתוב לי *נרשמתי* ואשלח הוראות המשך 🎉";
const GEMINI_WHATSAPP_MODEL = "gemini-2.5-flash" as const;
import {
  CLAUDE_WHATSAPP_MODEL,
  CLAUDE_WHATSAPP_MAX_TOKENS,
  resolveClaudeApiKey,
  formatUserFacingClaudeError,
  isRetryableClaudeError,
  sleepMs,
} from "@/lib/claude";
import {
  extractErrorCode,
  fetchLastAssistantModelUsed,
  fetchLastSfServiceEventName,
  fetchLastSfWarmupExtraIndex,
  fetchRecentSessionMessages,
  HEYZOE_SF_CTA_REACHED,
  HEYZOE_SF_REGISTERED,
  HEYZOE_SF_SERVICE_PREFIX,
  HEYZOE_SF_WARMUP_EXTRA_PREFIX,
  logMessage,
} from "@/lib/analytics";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// In-process dedup: prevents double-processing when Twilio retries the webhook
const processedMessageIds = new Set<string>();

function waNormLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeGreetingToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[!.,?;:~'"`\-]+/g, "")
    .replace(/\s+/g, " ");
}

function resolveWaMenuChoice(
  raw: string,
  metaInteractiveReplyId: string | undefined,
  candidates: string[],
  /** לתשובה מספרית בלבד — מניעת בלבול בין תפריט ראשי לתפריט המשך */
  numericScope?: string[]
): string {
  const trimmed = raw.trim();
  if (/^[1-9]$/.test(trimmed) && numericScope && numericScope.length) {
    const idx = Number(trimmed);
    if (idx >= 1 && idx <= numericScope.length) return numericScope[idx - 1]!;
  }
  const base = metaInteractiveReplyId?.trim()
    ? resolveMetaInteractiveLabel(metaInteractiveReplyId, raw, candidates)
    : raw.trim();
  let label = base.trim();
  const n = waNormLabel(label);
  const asNum = Number(n);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= candidates.length) {
    label = candidates[asNum - 1] ?? label;
  }
  return label;
}

function waLabelMatches(a: string, b: string): boolean {
  return waNormLabel(a) === waNormLabel(b);
}

function isAddressOrDirectionsIntent(text: string): boolean {
  const normalized = normalizeGreetingToken(text);
  return (
    normalized.includes("מה הכתובת") ||
    normalized.includes("כתובת") ||
    normalized.includes("איך מגיעים") ||
    normalized.includes("איך להגיע") ||
    normalized.includes("הנחיות הגעה") ||
    normalized.includes("דרכי הגעה") ||
    normalized.includes("איך באים") ||
    normalized.includes("איך מגיעה")
  );
}

type HeyzoeSessionPhase = "opening" | "warmup" | "cta" | "registered";

function normalizeSessionPhase(raw: unknown): HeyzoeSessionPhase {
  const s = String(raw ?? "").trim();
  if (s === "warmup" || s === "cta" || s === "registered" || s === "opening") return s;
  return "opening";
}

async function updateContactSessionPhase(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  phone: string;
  phase: HeyzoeSessionPhase;
}): Promise<void> {
  const { supabase, businessId, phone, phase } = input;
  try {
    const { error } = await supabase
      .from("contacts")
      .update({ session_phase: phase, flow_step: 0 })
      .eq("business_id", businessId)
      .eq("phone", phone);
    if (error) console.warn("[WA Webhook] session_phase update failed:", error.message);
  } catch (e) {
    console.warn("[WA Webhook] session_phase update threw:", e);
  }
}

async function bumpContactFlowStep(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  phone: string;
  nextStep: number;
}): Promise<void> {
  const { supabase, businessId, phone, nextStep } = input;
  const step = Number.isFinite(nextStep) && nextStep >= 0 ? Math.floor(nextStep) : 0;
  try {
    const { error } = await supabase.from("contacts").update({ flow_step: step }).eq("business_id", businessId).eq("phone", phone);
    if (error) console.warn("[WA Webhook] flow_step update failed:", error.message);
  } catch (e) {
    console.warn("[WA Webhook] flow_step update threw:", e);
  }
}

function filterCtaButtonsForTrialRegistered(
  cfg: NonNullable<BusinessKnowledgePack["salesFlowConfig"]>,
  trialRegistered: boolean | null,
  allowTrialCta: boolean
): SalesFlowCtaButton[] {
  const bs = cfg.cta_buttons ?? [];
  if (trialRegistered !== true) return bs;
  if (allowTrialCta) return bs;
  return bs.filter((b) => b.kind !== "trial");
}

function getWhatsAppOpeningGreetingTextOnly(k: BusinessKnowledgePack): string {
  if (k.salesFlowConfig) {
    return composeGreeting(
      k.salesFlowConfig,
      k.botName,
      k.businessName,
      k.taglineText || k.businessDescription,
      k.addressText ?? ""
    ).trim();
  }
  const { body } = getWhatsAppOpeningBodyAndMenuLabels(k);
  return body.trim();
}

type SfServiceRow = {
  name: string;
  benefit: string;
  priceText: string;
  durationText: string;
  levelsEnabled: boolean;
  levels: string[];
};

async function sendSalesFlowCtaMenuWithPhaseUpdate(input: {
  knowledge: BusinessKnowledgePack;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  salesFlowServices: SfServiceRow[];
  trialRegistered: boolean | null;
  allowTrialCta: boolean;
  extraBodyLines?: string[];
  modelUsed: string;
}): Promise<void> {
  const {
    knowledge,
    msg,
    accountSid,
    authToken,
    supabase,
    businessId,
    business_slug,
    sessionId,
    salesFlowServices,
    trialRegistered,
    allowTrialCta,
    extraBodyLines,
    modelUsed,
  } = input;
  const cfg = knowledge.salesFlowConfig;
  if (!cfg || !businessId) return;

  const filtered = filterCtaButtonsForTrialRegistered(cfg, trialRegistered, allowTrialCta);
  const ctaLabels = filtered.map((b) => b.label.trim()).filter((l) => l.length > 0).slice(0, 12);

  const selectedServiceName =
    salesFlowServices.length === 1
      ? salesFlowServices[0]!.name
      : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
  const selectedService =
    salesFlowServices.find((s) => s.name === selectedServiceName) ?? salesFlowServices[0] ?? null;

  const baseCtaBody = fillCtaBodyTemplate(
    cfg.cta_body,
    selectedService?.priceText ?? "",
    selectedService?.durationText ?? ""
  ).trim();

  const lastAssistModelForPromo = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
  const promo = knowledge?.promotionsText?.trim() ?? "";
  const promoIsTrial = promo && /(אימון|שיעור)\s*ניסיון|ניסיון/u.test(promo);
  const shouldAttachTrialPromo =
    trialRegistered !== true && promoIsTrial && lastAssistModelForPromo !== "sales_flow_cta";

  const ctaBody = [baseCtaBody, ...(extraBodyLines ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)]
    .concat(shouldAttachTrialPromo ? [promo] : [])
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!ctaBody) return;

  if (ctaLabels.length >= 2) {
    await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, ctaBody, ctaLabels.slice(0, 3), accountSid, authToken, {
      footerHint: ZOE_WHATSAPP_MENU_FOOTER,
    }).catch((e) => console.error("[WA Webhook] sendSalesFlowCtaMenu failed:", e));
  } else {
    await sendWhatsAppMessage(msg.toNumber, msg.from, `${ctaBody}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] sendSalesFlowCtaMenu plain failed:", e)
    );
  }

  await logMessage({
    business_slug,
    role: "assistant",
    content: `${ctaBody}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`,
    model_used: modelUsed,
    session_id: sessionId,
  });
  await logMessage({
    business_slug,
    role: "event",
    content: HEYZOE_SF_CTA_REACHED,
    model_used: "sf_cta_reached",
    session_id: sessionId,
  });
  await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: "cta" });
}

function scheduleFlowContinuation(input: {
  delayMs: number;
  phase: HeyzoeSessionPhase;
  contact: { flow_step: number };
  knowledge: BusinessKnowledgePack;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  salesFlowServices: SfServiceRow[];
  trialRegistered: boolean | null;
  allowTrialCta: boolean;
}): void {
  const delayMs = Number.isFinite(input.delayMs) ? Math.max(0, Math.floor(input.delayMs)) : 0;
  setTimeout(() => {
    void sendFlowContinuation(input).catch((e) => console.error("[WA Webhook] sendFlowContinuation failed:", e));
  }, delayMs);
}

async function sendFlowContinuation(input: {
  phase: HeyzoeSessionPhase;
  contact: { flow_step: number };
  knowledge: BusinessKnowledgePack;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  salesFlowServices: SfServiceRow[];
  trialRegistered: boolean | null;
  allowTrialCta: boolean;
}): Promise<void> {
  const { phase, contact, knowledge, msg, accountSid, authToken, supabase, businessId, business_slug, sessionId, salesFlowServices, trialRegistered, allowTrialCta } =
    input;
  const cfg = knowledge.salesFlowConfig;
  if (!cfg || !businessId) return;

  if (phase === "registered") {
    const ig = knowledge.instagramUrl?.trim();
    const parts = [
      ig ? `מוזמנים לעקוב אחרינו באינסטגרם:\n${ig}` : "",
      "ואם יש עוד משהו — כתבו כאן ואשמח לענות 🙂",
    ].filter(Boolean);
    const txt = parts.join("\n\n").trim();
    if (!txt) return;
    await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] flow continuation registered failed:", e)
    );
    await logMessage({
      business_slug,
      role: "assistant",
      content: txt,
      model_used: "flow_continuation_registered_soft",
      session_id: sessionId,
    });
    return;
  }

  if (phase === "cta") {
    const lastAssistModelForCta = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
    const promo = knowledge?.promotionsText?.trim() ?? "";
    const promoIsTrial = promo && /(אימון|שיעור)\s*ניסיון|ניסיון/u.test(promo);
    const shouldAttachTrialPromo =
      trialRegistered !== true && promoIsTrial && lastAssistModelForCta !== "sales_flow_cta";
    await sendSalesFlowCtaMenuWithPhaseUpdate({
      knowledge,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      salesFlowServices,
      trialRegistered,
      allowTrialCta,
      extraBodyLines: shouldAttachTrialPromo ? [promo] : [],
      modelUsed: "flow_continuation_cta",
    });
    return;
  }

  const step = Number.isFinite(contact.flow_step) ? contact.flow_step : 0;

  if (phase === "opening") {
    const extras = Array.isArray(cfg.greeting_extra_steps) ? cfg.greeting_extra_steps : [];
    const cleanGreeting = extras
      .map((s) => ({
        question: String((s as any)?.question ?? "").trim(),
        options: Array.isArray((s as any)?.options)
          ? (s as any).options.map((x: any) => String(x ?? "").trim()).filter(Boolean)
          : [],
      }))
      .filter((s) => s.question && s.options.length >= 2);

    if (step < cleanGreeting.length) {
      const st = cleanGreeting[step]!;
      await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, st.question, st.options, accountSid, authToken, {
        footerHint: ZOE_WHATSAPP_MENU_FOOTER,
      }).catch((e) => console.error("[WA Webhook] flow continuation opening extra failed:", e));
      await logMessage({
        business_slug,
        role: "assistant",
        content: `${st.question}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`,
        model_used: "flow_continuation_opening_extra",
        session_id: sessionId,
      });
      await bumpContactFlowStep({ supabase, businessId, phone: msg.from, nextStep: step + 1 });
      return;
    }

    if (salesFlowServices.length > 1) {
      const q = cfg.multi_service_question.trim();
      const labels = salesFlowServices.map((s) => s.name.trim()).filter(Boolean).slice(0, 12);
      if (!q || labels.length < 2) return;
      await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, q, labels.slice(0, 3), accountSid, authToken, {
        footerHint: ZOE_WHATSAPP_MENU_FOOTER,
      }).catch((e) => console.error("[WA Webhook] flow continuation opening services failed:", e));
      await logMessage({
        business_slug,
        role: "assistant",
        content: `${q}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`,
        model_used: "flow_continuation_opening_service_pick",
        session_id: sessionId,
      });
      return;
    }

      await sendFlowContinuation({
      phase: "warmup",
      contact: { flow_step: 0 },
      knowledge,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      salesFlowServices,
      trialRegistered,
        allowTrialCta,
    });
    return;
  }

  // warmup
  if (step === 0) {
    const named =
      salesFlowServices.length === 1
        ? salesFlowServices[0]!.name
        : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
    if (!named) return;
    const q = String(cfg.experience_question ?? "").replace(/\{serviceName\}/g, named);
    const opts = [...cfg.experience_options].map((o) => String(o ?? "").trim()).filter(Boolean);
    if (!q || opts.length < 2) return;
    await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, q, opts.slice(0, 3), accountSid, authToken, {
      footerHint: ZOE_WHATSAPP_MENU_FOOTER,
    }).catch((e) => console.error("[WA Webhook] flow continuation warmup experience failed:", e));
    await logMessage({
      business_slug,
      role: "assistant",
      content: `${q}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`,
      model_used: "flow_continuation_warmup_experience",
      session_id: sessionId,
    });
    await bumpContactFlowStep({ supabase, businessId, phone: msg.from, nextStep: 1 });
    return;
  }

  const warmExtras = Array.isArray(cfg.opening_extra_steps) ? cfg.opening_extra_steps : [];
  const cleanWarm = warmExtras
    .map((s) => ({
      question: String((s as any)?.question ?? "").trim(),
      options: Array.isArray((s as any)?.options)
        ? (s as any).options.map((x: any) => String(x ?? "").trim()).filter(Boolean)
        : [],
    }))
    .filter((s) => s.question && s.options.length >= 2);
  const idx = step - 1;
  const st = cleanWarm[idx];
  if (st) {
    await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, st.question, st.options, accountSid, authToken, {
      footerHint: ZOE_WHATSAPP_MENU_FOOTER,
    }).catch((e) => console.error("[WA Webhook] flow continuation warmup extra failed:", e));
    await logMessage({
      business_slug,
      role: "assistant",
      content: `${st.question}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`,
      model_used: "flow_continuation_warmup_extra",
      session_id: sessionId,
    });
    await bumpContactFlowStep({ supabase, businessId, phone: msg.from, nextStep: step + 1 });
    return;
  }

  const lastAssistModelForCta = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
  const promo = knowledge?.promotionsText?.trim() ?? "";
  const promoIsTrial = promo && /(אימון|שיעור)\s*ניסיון|ניסיון/u.test(promo);
  const shouldAttachTrialPromo =
    trialRegistered !== true && promoIsTrial && lastAssistModelForCta !== "sales_flow_cta";
  await sendSalesFlowCtaMenuWithPhaseUpdate({
    knowledge,
    msg,
    accountSid,
    authToken,
    supabase,
    businessId,
    business_slug,
    sessionId,
    salesFlowServices,
    trialRegistered,
    allowTrialCta,
    extraBodyLines: shouldAttachTrialPromo ? [promo] : [],
    modelUsed: "flow_continuation_cta",
  });
}

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
  msg: WaIncomingMessage,
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
  let contactTrialRegistered: boolean | null = null;
  // Session-only override: allow offering the trial CTA again after a greeting reset,
  // without mutating the persisted trial_registered conversion flag.
  let allowTrialCtaThisSession = false;
  let contactSessionPhase: HeyzoeSessionPhase = "opening";
  let contactFlowStep = 0;
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
        followup_sent: false,
      };
      if (fullName) upsertPayload.full_name = fullName;

      // Select `claude_message_count` if the column exists; fall back gracefully otherwise.
      let contactRow: any = null;
      let upsertErr: any = null;
      try {
        const r = await supabase
          .from("contacts")
          .upsert(upsertPayload, { onConflict: "business_id,phone" })
          .select("opted_out, claude_message_count, trial_registered, session_phase, flow_step")
          .maybeSingle();
        contactRow = r.data;
        upsertErr = r.error;
        if (upsertErr && String(upsertErr.message ?? "").toLowerCase().includes("session_phase")) {
          const r2 = await supabase
            .from("contacts")
            .upsert(upsertPayload, { onConflict: "business_id,phone" })
            .select("opted_out, claude_message_count, trial_registered")
            .maybeSingle();
          contactRow = r2.data;
          upsertErr = r2.error;
        }
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
      contactTrialRegistered =
        typeof (contactRow as any)?.trial_registered === "boolean"
          ? (contactRow as any).trial_registered
          : null;
      allowTrialCtaThisSession = contactTrialRegistered !== true;

      contactSessionPhase = normalizeSessionPhase((contactRow as any)?.session_phase);
      const fs = (contactRow as any)?.flow_step;
      contactFlowStep = typeof fs === "number" && Number.isFinite(fs) ? fs : 0;
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

  const knowledge = await getBusinessKnowledgePack(business_slug);
  let salesFlowServices: SfServiceRow[] = [];
  if (knowledge?.salesFlowConfig && businessId) {
    try {
      const { data: services } = await supabase
        .from("services")
        .select("name, description, service_slug, price_text")
        .eq("business_id", Number(businessId))
        .order("created_at", { ascending: true })
        .limit(24);
      salesFlowServices = (services ?? [])
        .map((s: { name?: unknown; description?: unknown; price_text?: unknown }) => ({
          name: String(s.name ?? "").trim(),
          ...(() => {
            try {
              const raw = String(s.description ?? "");
              const candidate = raw.trim().startsWith("__META__:") ? raw.trim().slice("__META__:".length) : raw;
              const meta = JSON.parse(candidate || "{}") as Record<string, unknown>;
              return {
                benefit: String(meta.benefit_line ?? "").trim(),
                priceText: String(s.price_text ?? meta.price_text ?? "").trim(),
                durationText: String(meta.duration ?? "").trim(),
                levelsEnabled: meta.levels_enabled === true,
                levels: Array.isArray(meta.levels)
                  ? meta.levels.map((x) => String(x ?? "").trim()).filter(Boolean)
                  : [],
              };
            } catch {
              return {
                benefit: "",
                priceText: String(s.price_text ?? "").trim(),
                durationText: "",
                levelsEnabled: false,
                levels: [],
              };
            }
          })(),
        }))
        .filter((s: SfServiceRow) => s.name);
    } catch (e) {
      console.warn("[WA Webhook] sales-flow services load failed:", e);
    }
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

  // Trial registration keyword → update contact + send after-trial template (no Claude)
  if (msg.type === "text" && businessId && knowledge) {
    const rawTrimmed = msg.text.trim();
    if (matchesTrialRegisteredMessage(rawTrimmed)) {
      try {
        let alreadyRegistered = false;
        const sel = await supabase
          .from("contacts")
          .select("trial_registered")
          .eq("business_id", businessId)
          .eq("phone", msg.from)
          .maybeSingle();
        if (sel.error) {
          console.warn("[WA Webhook] trial_registered select:", sel.error.message);
        } else if ((sel.data as { trial_registered?: boolean } | null)?.trial_registered === true) {
          alreadyRegistered = true;
        }

        if (alreadyRegistered) {
          const repeatTxt =
            "כבר שלחנו את הוראות ההמשך. אם משהו חסר - כתבו כאן ונעזור 😊";
          await sendWhatsAppMessage(msg.toNumber, msg.from, repeatTxt, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send trial-registered repeat reply failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: repeatTxt,
            model_used: "trial_registered_repeat_ack",
            session_id: sessionId,
          });
          return;
        }

        const bodyTemplate =
          knowledge.salesFlowConfig?.after_trial_registration_body?.trim() ||
          defaultSalesFlowConfig(knowledge.vibeLabels ?? []).after_trial_registration_body;

        const delivered = formatAfterTrialRegistrationForWhatsAppDelivery(
          bodyTemplate,
          knowledge.instagramUrl ?? "",
          knowledge.addressText ?? "",
          knowledge.directionsText ?? ""
        );
        const outText =
          delivered.trim().length > 0
            ? delivered
            : "תודה על ההרשמה! נתראה באימון 🎉";

        const { error: upErr } = await supabase
          .from("contacts")
          .update({ trial_registered: true, trial_registered_at: nowIso })
          .eq("business_id", businessId)
          .eq("phone", msg.from);
        if (upErr) {
          console.warn("[WA Webhook] trial_registered update failed:", upErr.message);
        } else {
          await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: "registered" });
          contactSessionPhase = "registered";
          contactFlowStep = 0;
          await logMessage({
            business_slug,
            role: "event",
            content: HEYZOE_SF_REGISTERED,
            model_used: "sf_registered",
            session_id: sessionId,
          });
        }

        const directionsMediaUrl = knowledge.directionsMediaUrl?.trim() ?? "";
        const directionsCaption = [
          knowledge.addressText?.trim() ? `הכתובת שלנו:\n${knowledge.addressText.trim()}` : "",
          knowledge.directionsText?.trim() ? `ככה מגיעים אלינו:\n${knowledge.directionsText.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        if (directionsMediaUrl) {
          await sendWhatsAppMediaMessage(
            msg.toNumber,
            msg.from,
            directionsMediaUrl,
            accountSid,
            authToken,
            directionsCaption || undefined,
            knowledge.directionsMediaType === "video"
              ? "video"
              : knowledge.directionsMediaType === "image"
                ? "image"
                : undefined
          ).catch((e) => console.error("[WA Webhook] Send directions media after registration failed:", e));
          await logMessage({
            business_slug,
            role: "assistant",
            content: `[media] ${directionsMediaUrl}${directionsCaption ? `\n\n${directionsCaption}` : ""}`,
            model_used: "directions_media",
            session_id: sessionId,
          });
        }

        await sendWhatsAppMessage(msg.toNumber, msg.from, outText, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send after-trial registration body failed:", e)
        );
        await logMessage({
          business_slug,
          role: "assistant",
          content: outText,
          model_used: "sales_flow_after_trial_registered",
          session_id: sessionId,
        });
        return;
      } catch (e) {
        console.warn("[WA Webhook] trial_registered flow failed (continuing to normal handling):", e);
      }
    }
  }

  const sendOpeningMediaIfConfigured = async (): Promise<boolean> => {
    const mediaUrl = knowledge?.openingMediaUrl?.trim() ?? "";
    if (!mediaUrl) return false;
    const mediaKind =
      knowledge?.openingMediaType === "video"
        ? "video"
        : knowledge?.openingMediaType === "image"
          ? "image"
          : undefined;
    const attempt = async () => {
      await sendWhatsAppMediaMessage(
        msg.toNumber,
        msg.from,
        mediaUrl,
        accountSid,
        authToken,
        undefined,
        mediaKind
      );
      await logMessage({
        business_slug,
        role: "assistant",
        content: `[media] ${mediaUrl}`,
        model_used: "opening_media",
        session_id: sessionId,
      });
    };
    try {
      await attempt();
      return true;
    } catch (e) {
      console.error("[WA Webhook] sending opening media failed (retrying once):", {
        mediaUrl,
        mediaKind,
        provider: msg.toNumber?.trim()?.match(/^\d+$/) ? "meta_or_twilio" : "unknown",
        e,
      });
      try {
        await sleepMs(250);
        await attempt();
        return true;
      } catch (e2) {
        console.error("[WA Webhook] sending opening media failed (giving up):", { mediaUrl, mediaKind, e: e2 });
        return false;
      }
    }
  };

  // New lead flow: optional media first, then a default opening message (no AI)
  // If the user just opted back in, continue to Zoe instead of stopping on default opening.
  if (isNewLead && !optedInThisMessage) {
    const didSendOpeningMedia = await sendOpeningMediaIfConfigured();
    if (didSendOpeningMedia) {
      // WhatsApp clients can render media later than subsequent texts; delay so the media appears first.
      await sleepMs(knowledge?.openingMediaType === "video" ? 2200 : 1300);
    }

    const openingText = knowledge
      ? getWhatsAppOpeningGreetingTextOnly(knowledge).trim()
      : `היי! כאן ${business_slug}.\nאשמח לעזור - שלחו שאלה בקצרה.`;

    try {
      if (knowledge) {
        const greetOnly = getWhatsAppOpeningGreetingTextOnly(knowledge);
        await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, greetOnly, [], accountSid, authToken, {
          footerHint: "",
        });
      } else {
        await sendWhatsAppMessage(msg.toNumber, msg.from, openingText, accountSid, authToken);
      }
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

    if (businessId && knowledge?.salesFlowConfig) {
      const phase: HeyzoeSessionPhase = salesFlowServices.length === 1 ? "warmup" : "opening";
      await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase });
      contactSessionPhase = phase;
      contactFlowStep = 0;
      // IMPORTANT: route handlers may run in a serverless context where setTimeout is not reliable after response.
      // We send the continuation within this request to guarantee delivery order.
      await sleepMs(1500);
      await sendFlowContinuation({
        phase,
        contact: { flow_step: 0 },
        knowledge,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        salesFlowServices,
        trialRegistered: contactTrialRegistered,
        allowTrialCta: allowTrialCtaThisSession,
      });
    }

    return;
  }

  // ───────────────────── Priority routing (no Claude first) ───────────────────
  // 0) Greeting messages (deterministic) — don't send to Claude.
  if (msg.type === "text") {
    const greet = normalizeGreetingToken(msg.text);
    const GREETINGS = new Set(["שלום", "היי", "הי", "אהלן", "hello", "hi"]);
    if (GREETINGS.has(greet)) {
      // איפוס שלב שיחה בלבד (לא trial_registered) — פלואו מתחיל מחדש.
      const didSendOpeningMedia = await sendOpeningMediaIfConfigured();
      if (didSendOpeningMedia) {
        // WhatsApp clients can render media later than subsequent texts; delay so the media appears first.
        await sleepMs(knowledge?.openingMediaType === "video" ? 2200 : 1300);
      }
      const out = knowledge
        ? getWhatsAppOpeningGreetingTextOnly(knowledge).trim()
        : `היי! כאן ${business_slug}.\nאשמח לעזור - שלחו שאלה בקצרה.`;

      if (knowledge) {
        const greetOnly = getWhatsAppOpeningGreetingTextOnly(knowledge);
        await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, greetOnly, [], accountSid, authToken, {
          footerHint: "",
        }).catch((e) => console.error("[WA Webhook] Send greeting reply failed:", e));
      } else {
        await sendWhatsAppMessage(msg.toNumber, msg.from, out, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send greeting reply failed:", e)
        );
      }
      await logMessage({
        business_slug,
        role: "assistant",
        content: out,
        model_used: "greeting",
        session_id: sessionId,
      });
      if (businessId && knowledge?.salesFlowConfig) {
        // Greeting resets the *flow* (session_phase + flow_step) but must NOT mutate trial_registered conversion history.
        // We allow trial CTA again for this session only.
        allowTrialCtaThisSession = true;

        const phase: HeyzoeSessionPhase = salesFlowServices.length === 1 ? "warmup" : "opening";
        await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase });
        contactSessionPhase = phase;
        contactFlowStep = 0;
        // IMPORTANT: route handlers may run in a serverless context where setTimeout is not reliable after response.
        // We send the continuation within this request to guarantee delivery order.
        await sleepMs(1500);
        await sendFlowContinuation({
          phase,
          contact: { flow_step: 0 },
          knowledge,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          salesFlowServices,
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
        });
      }
      return;
    }
  }

  // 1) Sales flow: בחירת שירות (מרובים) → מענה + שאלת ניסיון
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId && salesFlowServices.length > 1) {
    try {
      const named = salesFlowServices;
      const raw = msg.text.trim();
      const rawLower = raw.toLowerCase();
      const num = Number(rawLower);
      const picked =
        Number.isFinite(num) && num >= 1 && num <= named.length
          ? named[num - 1]
          : named.find((s) => s.name.toLowerCase() === rawLower) ??
            named.find((s) => rawLower && s.name.toLowerCase().includes(rawLower));

      if (picked) {
        const cfg = knowledge.salesFlowConfig;
        const afterPick = fillAfterServicePickTemplate(cfg.after_service_pick, picked.name, picked.benefit);
        const q = String(cfg.experience_question ?? "").replace(/\{serviceName\}/g, picked.name);
        const opts = Array.isArray(cfg.experience_options) ? [...cfg.experience_options] : [];

        const out =
          [afterPick, "", q, ...opts]
            .filter((x) => x !== undefined && String(x).trim().length > 0)
            .join("\n")
            .trim() + `\n\n${ZOE_WHATSAPP_MENU_FOOTER}`;
        const bodyOnly = [afterPick, "", q]
          .filter((x) => String(x ?? "").trim().length > 0)
          .join("\n\n")
          .trim();

        await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, bodyOnly, opts, accountSid, authToken, {
          footerHint: ZOE_WHATSAPP_MENU_FOOTER,
        }).catch((e) => console.error("[WA Webhook] Send sales-flow pick reply failed:", e));
        await logMessage({
          business_slug,
          role: "assistant",
          content: out,
          model_used: "sales_flow",
          session_id: sessionId,
        });
        await logMessage({
          business_slug,
          role: "event",
          content: `${HEYZOE_SF_SERVICE_PREFIX}${picked.name}`,
          model_used: "sf_service_pick",
          session_id: sessionId,
        });
        if (businessId) {
          await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: "warmup" });
          await bumpContactFlowStep({ supabase, businessId, phone: msg.from, nextStep: 1 });
          contactSessionPhase = "warmup";
          contactFlowStep = 1;
        }
        return;
      }
    } catch (e) {
      console.warn("[WA Webhook] Sales-flow service pick failed (continuing):", e);
    }
  }

  // 2) Sales flow: כפתורי CTA / תפריט המשך (לפני זיהוי שאלת ניסיון — כדי ש־1/2/3 יתאימו לתפריט הנוכחי)
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId) {
    const lastAssistModelForCta = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
    const digitOnlyForCta = /^[1-9]$/.test(msg.text.trim());
    const skipCtaBlockForDigit =
      digitOnlyForCta &&
      lastAssistModelForCta !== "sales_flow_cta" &&
      lastAssistModelForCta !== "sales_flow_post_link_menu";

    if (!skipCtaBlockForDigit) {
      try {
      const cfg = knowledge.salesFlowConfig!;
      const follow = cfg.followup_after_next_class_options;
      const ctaBs = cfg.cta_buttons;
      const unionLabels = [...ctaBs.map((b) => b.label.trim()), ...follow.map((x) => String(x ?? "").trim())].filter(
        (l) => l.length > 0
      );

      const fuOptsForNum = follow.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 3);
      const ctaOptsForNum = ctaBs.map((b) => b.label.trim()).filter(Boolean).slice(0, 12);
      const numericScope =
        lastAssistModelForCta === "sales_flow_post_link_menu"
          ? fuOptsForNum
          : lastAssistModelForCta === "sales_flow_cta"
            ? ctaOptsForNum
            : undefined;

      const incomingResolved = resolveWaMenuChoice(
        msg.text.trim(),
        msg.metaInteractiveReplyId,
        unionLabels.length ? unionLabels : ctaBs.map((b) => b.label),
        numericScope
      );

      const trialUrl = knowledge.arboxLink?.trim() ?? "";
      const scheduleUrl = (knowledge.schedulePublicUrl?.trim() || trialUrl).trim();

      const wantsTrialByFollow = follow[0] && waLabelMatches(incomingResolved, follow[0]);
      const wantsScheduleByFollow = follow[1] && waLabelMatches(incomingResolved, follow[1]);
      const wantsMembershipsByFollow = follow[2] && waLabelMatches(incomingResolved, follow[2]);
      const trialBtn = ctaBs.find((b) => b.kind === "trial");
      const schedBtn = ctaBs.find((b) => b.kind === "schedule");
      const memBtn = ctaBs.find((b) => b.kind === "memberships");
      const addressBtn = ctaBs.find((b) => b.kind === "address");

      const wantsTrial =
        wantsTrialByFollow || (trialBtn ? waLabelMatches(incomingResolved, trialBtn.label) : false);
      const wantsSchedule =
        wantsScheduleByFollow || (schedBtn ? waLabelMatches(incomingResolved, schedBtn.label) : false);
      const wantsMemberships =
        wantsMembershipsByFollow || (memBtn ? waLabelMatches(incomingResolved, memBtn.label) : false);
      const wantsAddressByButton = addressBtn ? waLabelMatches(incomingResolved, addressBtn.label) : false;
      const wantsAddressByIntent = isAddressOrDirectionsIntent(incomingResolved);
      const wantsAddress = wantsAddressByButton || wantsAddressByIntent;

      const sendPostLinkMenu = async (): Promise<void> => {
        const fuBody = cfg.followup_after_next_class_body.trim();
        const fuOpts = cfg.followup_after_next_class_options.map((x) => String(x ?? "").trim()).filter(Boolean);
        if (!fuBody || fuOpts.length < 3) return;
        const menuBody = fuBody;
        const menuLabels = fuOpts.slice(0, 3);
        const logged = [
          menuBody,
          menuLabels.map((label, index) => `${index + 1}. ${label}`).join("\n"),
          ZOE_WHATSAPP_MENU_FOOTER,
        ]
          .filter((x) => x.length > 0)
          .join("\n\n");
        await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, menuBody, menuLabels, accountSid, authToken, {
          footerHint: ZOE_WHATSAPP_MENU_FOOTER,
        }).catch((e) => console.error("[WA Webhook] Send post-link menu failed:", e));
        await logMessage({
          business_slug,
          role: "assistant",
          content: logged,
          model_used: "sales_flow_post_link_menu",
          session_id: sessionId,
        });
      };

      if (wantsTrial && contactTrialRegistered === true) {
        const ig = knowledge?.instagramUrl?.trim() ?? "";
        const soft = [
          "כבר נרשמתם לניסיון — מעולה 🎉",
          ig ? `בינתיים מוזמנים לעקוב אחרינו באינסטגרם:\n${ig}` : "",
          "ואם יש שאלה נוספת — פשוט כתבו כאן.",
        ]
          .filter(Boolean)
          .join("\n\n");
        await sendWhatsAppMessage(msg.toNumber, msg.from, soft, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send post-trial soft reply failed:", e)
        );
        await logMessage({
          business_slug,
          role: "assistant",
          content: soft,
          model_used: "sales_flow_trial_already_registered",
          session_id: sessionId,
        });
        return;
      }

      if (wantsTrial && trialUrl) {
        const txt = `איזו החלטה מדהימה 🙂 נרשמים ממש כאן:\n${trialUrl}`;
        await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send trial link failed:", e)
        );
        await sendWhatsAppMessage(msg.toNumber, msg.from, TRIAL_LINK_POST_CTA_MESSAGE, accountSid, authToken).catch(
          (e) => console.error("[WA Webhook] Send trial link post-CTA hint failed:", e)
        );
        // After "לאחר ההרשמה…" we don't need to push another CTA/menu.
        const logged = `${txt}\n\n${TRIAL_LINK_POST_CTA_MESSAGE}`;
        await logMessage({
          business_slug,
          role: "assistant",
          content: logged,
          model_used: "sales_flow_trial_link",
          session_id: sessionId,
        });
        return;
      }
      if (wantsTrial && !trialUrl) {
        const txt =
          "כרגע אין לנו כאן קישור הרשמה - כתבו בקצרה ונחזור אליכם, או בחרו צפייה במערכת השעות.";
        await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
        await logMessage({
          business_slug,
          role: "assistant",
          content: txt,
          model_used: "sales_flow_trial_missing",
          session_id: sessionId,
        });
        return;
      }

      if (wantsSchedule && scheduleUrl) {
        const txt = `צפייה במערכת השעות:\n${scheduleUrl}`;
        await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send schedule link failed:", e)
        );
        await sendPostLinkMenu();
        await logMessage({
          business_slug,
          role: "assistant",
          content: txt,
          model_used: "sales_flow_schedule_link",
          session_id: sessionId,
        });
        return;
      }
      if (wantsSchedule && !scheduleUrl) {
        const txt = "מערכת השעות תתעדכן בקרוב - כתבו בקצרה ונעזור לקבוע מועד.";
        await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
        await logMessage({
          business_slug,
          role: "assistant",
          content: txt,
          model_used: "sales_flow_schedule_missing",
          session_id: sessionId,
        });
        return;
      }
      if (wantsMemberships) {
        const mu = knowledge?.membershipsUrl?.trim() ?? "";
        const promo = knowledge?.promotionsText?.trim() ?? "";
        const promoIsMemberships = promo && /(מנוי|מנויים|כרטיסי(?:ה|ות)|חבילה)/u.test(promo);
        const txt = mu.length
          ? [`מחירי מנויים:`, mu, promoIsMemberships ? promo : ""].filter(Boolean).join("\n")
          : "לפרטים על מחירי המנויים, צרו קשר ישירות עם הסטודיו 😊";
        await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send memberships reply failed:", e)
        );
        if (mu.length) await sendPostLinkMenu();
        await logMessage({
          business_slug,
          role: "assistant",
          content: txt,
          model_used: mu.length ? "sales_flow_memberships_link" : "sales_flow_memberships_fallback",
          session_id: sessionId,
        });
        return;
      }
      if (wantsAddress) {
        const address = knowledge?.addressText?.trim() ?? "";
        const directions = knowledge?.directionsText?.trim() ?? "";
        const txt = address
          ? [`הכתובת שלנו:`, address, directions ? `ככה מגיעים אלינו:\n${directions}` : ""].filter(Boolean).join("\n")
          : "הכתובת תתעדכן בקרוב. כתבו לנו ונשלח לכם את כל הפרטים.";
        const directionsMediaUrl = knowledge?.directionsMediaUrl?.trim() ?? "";
        if (directionsMediaUrl) {
          await sendWhatsAppMediaMessage(
            msg.toNumber,
            msg.from,
            directionsMediaUrl,
            accountSid,
            authToken,
            txt,
            knowledge?.directionsMediaType === "video"
              ? "video"
              : knowledge?.directionsMediaType === "image"
                ? "image"
                : undefined
          ).catch((e) => console.error("[WA Webhook] Send address media reply failed:", e));
          // WhatsApp can show a subsequent text/menu before media finishes processing on the client.
          // Delay the follow-up menu enough so the media+caption reliably appears first.
          await sleepMs(knowledge?.directionsMediaType === "video" ? 2200 : 1300);
        } else {
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send address reply failed:", e)
          );
        }
        await logMessage({
          business_slug,
          role: "assistant",
          content: directionsMediaUrl ? `[media] ${directionsMediaUrl}\n\n${txt}` : txt,
          model_used: address ? "sales_flow_address" : "sales_flow_address_missing",
          session_id: sessionId,
        });
        // Always follow with the standard post-link menu when we have an address.
        // (After a delay if media was sent) so the menu appears after the directions message.
        if (address) {
          await sendPostLinkMenu();
        }
        return;
      }
      } catch (e) {
        console.warn("[WA Webhook] Sales-flow CTA handling failed (continuing):", e);
      }
    }
  }

  // 2.5) Sales flow: שאלות נוספות בסשן חימום (אחרי שאלת ניסיון קודם, לפני CTA)
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId) {
    try {
      const cfg = knowledge.salesFlowConfig!;
      const steps = Array.isArray(cfg.opening_extra_steps) ? cfg.opening_extra_steps : [];
      const cleanSteps = steps
        .map((s) => ({
          question: String((s as any)?.question ?? "").trim(),
          options: Array.isArray((s as any)?.options)
            ? (s as any).options.map((x: any) => String(x ?? "").trim()).filter(Boolean)
            : [],
        }))
        .filter((s) => s.question && s.options.length >= 2);
      if (cleanSteps.length > 0) {
        const lastAssistModel = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
        const lastIdx = await fetchLastSfWarmupExtraIndex({ business_slug, session_id: sessionId });
        if (lastAssistModel === "sales_flow_warmup_extra" && lastIdx != null) {
          const current = cleanSteps[lastIdx];
          const incomingResolved = resolveWaMenuChoice(msg.text.trim(), msg.metaInteractiveReplyId, current?.options ?? []);
          const picked = (current?.options ?? []).find((o: string) => waLabelMatches(incomingResolved, o));
          if (picked) {
            const nextIdx = lastIdx + 1;
            if (nextIdx < cleanSteps.length) {
              const next = cleanSteps[nextIdx]!;
              await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, next.question, next.options, accountSid, authToken, {
                footerHint: ZOE_WHATSAPP_MENU_FOOTER,
              }).catch((e) => console.error("[WA Webhook] Send warmup-extra next step failed:", e));
              await logMessage({
                business_slug,
                role: "assistant",
                content: `${next.question}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`,
                model_used: "sales_flow_warmup_extra",
                session_id: sessionId,
              });
              await logMessage({
                business_slug,
                role: "event",
                content: `${HEYZOE_SF_WARMUP_EXTRA_PREFIX}${nextIdx}`,
                model_used: "sf_warmup_extra",
                session_id: sessionId,
              });
              return;
            }
            // Finished warmup extras → send CTA deterministically (no AI).
            if (businessId) {
              await sendSalesFlowCtaMenuWithPhaseUpdate({
                knowledge,
                msg,
                accountSid,
                authToken,
                supabase,
                businessId,
                business_slug,
                sessionId,
                salesFlowServices,
                trialRegistered: contactTrialRegistered,
                allowTrialCta: allowTrialCtaThisSession,
                modelUsed: "sales_flow_cta",
              });
              contactSessionPhase = "cta";
              contactFlowStep = 0;
            }
            return;
          }
        }
      }
    } catch (e) {
      console.warn("[WA Webhook] Warmup extra steps handling failed (continuing):", e);
    }
  }

  // 3) Sales flow: מענה על שאלת ניסיון קודם → הנעה לפעולה + תפריט CTA
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId && salesFlowServices.length >= 1) {
    try {
      const cfg = knowledge.salesFlowConfig;
      const opts = cfg.experience_options.map((o) => String(o ?? "").trim()).filter(Boolean);
      if (opts.length >= 3) {
        const incomingResolved = resolveWaMenuChoice(msg.text.trim(), msg.metaInteractiveReplyId, opts);
        const pickedExp = opts.find((o) => waLabelMatches(incomingResolved, o));
        const canExperience =
          salesFlowServices.length === 1 ||
          Boolean(await fetchLastSfServiceEventName({ business_slug, session_id: sessionId }));
        if (pickedExp && canExperience) {
          const selectedServiceName =
            salesFlowServices.length === 1
              ? salesFlowServices[0]!.name
              : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
          const selectedService =
            salesFlowServices.find((service) => service.name === selectedServiceName) ?? salesFlowServices[0] ?? null;
          const afterExperience = fillAfterExperienceTemplate(
            cfg.after_experience,
            selectedService?.levelsEnabled ?? false,
            selectedService?.levels ?? []
          ).trim();
          const steps = Array.isArray(cfg.opening_extra_steps) ? cfg.opening_extra_steps : [];
          const cleanSteps = steps
            .map((s) => ({
              question: String((s as any)?.question ?? "").trim(),
              options: Array.isArray((s as any)?.options)
                ? (s as any).options.map((x: any) => String(x ?? "").trim()).filter(Boolean)
                : [],
            }))
            .filter((s) => s.question && s.options.length >= 2);
          if (cleanSteps.length > 0) {
            const first = cleanSteps[0]!;
            const bodyOnly = [afterExperience].filter((x) => x.length > 0).join("\n\n").trim();
            const combined = [bodyOnly, first.question].filter(Boolean).join("\n\n").trim();
            await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, combined, first.options, accountSid, authToken, {
              footerHint: ZOE_WHATSAPP_MENU_FOOTER,
            }).catch((e) => console.error("[WA Webhook] Send warmup-extra first step failed:", e));
            await logMessage({
              business_slug,
              role: "assistant",
              content: `${combined}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`,
              model_used: "sales_flow_warmup_extra",
              session_id: sessionId,
            });
            await logMessage({
              business_slug,
              role: "event",
              content: `${HEYZOE_SF_WARMUP_EXTRA_PREFIX}0`,
              model_used: "sf_warmup_extra",
              session_id: sessionId,
            });
            return;
          }

          const bodyOnly = [afterExperience].filter((x) => x.length > 0).join("\n\n").trim();
          const out = bodyOnly;

          await sendWhatsAppMessage(msg.toNumber, msg.from, out, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send after-experience reply failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: out,
            model_used: "sales_flow_after_experience",
            session_id: sessionId,
          });

          await sleepMs(700);

          if (businessId) {
            await sendSalesFlowCtaMenuWithPhaseUpdate({
              knowledge,
              msg,
              accountSid,
              authToken,
              supabase,
              businessId,
              business_slug,
              sessionId,
              salesFlowServices,
              trialRegistered: contactTrialRegistered,
              allowTrialCta: allowTrialCtaThisSession,
              modelUsed: "sales_flow_cta",
            });
            contactSessionPhase = "cta";
            contactFlowStep = 0;
          }
          return;
        }
      }
    } catch (e) {
      console.warn("[WA Webhook] Sales-flow experience→CTA failed (continuing):", e);
    }
  }

  // 4) FAQ exact-ish match (dashboard data)
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
      const hit = (faqs ?? []).find((f: { question?: unknown }) => {
        const q = norm(String(f.question ?? ""));
        if (!q) return false;
        if (inTxt === q) return true;
        if (q.length >= 6 && inTxt.includes(q)) return true;
        if (inTxt.length >= 8 && q.includes(inTxt)) return true;
        return false;
      });

      const ans = hit ? String((hit as { answer?: unknown }).answer ?? "").trim() : "";
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

  // ── Quick-reply vs. "other question" routing ────────────────────────────────
  const quickLabels = (knowledge?.quickReplies ?? [])
    .map((qr) => qr.label.trim())
    .filter((lbl) => lbl.length > 0);
  const ctaMenuLabelsRaw = (knowledge?.salesFlowConfig?.cta_buttons ?? [])
    .map((b) => String((b as { label?: string }).label ?? "").trim())
    .filter((l) => l.length > 0);
      const filteredCtaButtons =
    knowledge?.salesFlowConfig != null
      ? filterCtaButtonsForTrialRegistered(knowledge.salesFlowConfig, contactTrialRegistered, allowTrialCtaThisSession)
      : [];
  const ctaMenuLabelsForAi =
    contactSessionPhase === "cta"
      ? filteredCtaButtons.map((b) => b.label.trim()).filter((l) => l.length > 0)
      : [];
  const buttons: string[] = [
    ...quickLabels,
    ...ctaMenuLabelsForAi.filter((l) => !quickLabels.some((q) => q === l)),
  ];

  const incomingRaw =
    msg.type === "text" && msg.metaInteractiveReplyId
      ? resolveMetaInteractiveLabel(msg.metaInteractiveReplyId, msg.text, buttons)
      : msg.type === "text"
        ? msg.text.trim()
        : "";
  const incomingNorm = incomingRaw.toLowerCase();

  // Allow numeric answers (1/2/3...) to map to the displayed buttons list.
  let incomingAsLabel = incomingRaw;
  const asNum = Number(incomingNorm);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= buttons.length) {
    incomingAsLabel = buttons[asNum - 1] ?? incomingRaw;
  }

  const matched = knowledge?.quickReplies?.find(
    (qr) => qr.label.trim().toLowerCase() === incomingAsLabel.trim().toLowerCase()
  );
  const predefinedClosedLabels = [
    ...quickLabels,
    ...(knowledge?.salesFlowConfig?.greeting_extra_steps ?? []).flatMap((step) => step.options.map((option) => option.trim())),
    ...salesFlowServices.map((service) => service.name.trim()),
    ...((knowledge?.salesFlowConfig?.experience_options ?? []).map((option) => String(option ?? "").trim())),
    ...ctaMenuLabelsRaw,
    ...((knowledge?.salesFlowConfig?.followup_after_next_class_options ?? []).map((option) => String(option ?? "").trim())),
  ].filter(Boolean);
  const matchedPredefinedClosedLabel =
    !matched?.reply && predefinedClosedLabels.find((label) => waLabelMatches(incomingAsLabel, label));
  const lastPickedServiceName =
    msg.type === "text" && knowledge?.salesFlowConfig && salesFlowServices.length > 1
      ? await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })
      : null;
  const shouldReaskServiceSelection =
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    salesFlowServices.length > 1 &&
    !lastPickedServiceName &&
    !matched?.reply &&
    !matchedPredefinedClosedLabel;
  const shouldUseCtaPromptOnly =
    !shouldReaskServiceSelection &&
    Boolean(knowledge?.salesFlowConfig) &&
    quickLabels.length === 0 &&
    ctaMenuLabelsForAi.length > 0 &&
    contactSessionPhase === "cta";
  const serviceSelectionLabels = shouldReaskServiceSelection
    ? salesFlowServices.map((service) => service.name.trim()).filter(Boolean).slice(0, 12)
    : [];
  const serviceSelectionQuestion =
    shouldReaskServiceSelection && knowledge?.salesFlowConfig?.multi_service_question?.trim()
      ? knowledge.salesFlowConfig.multi_service_question.trim()
      : "";
  const ctaPromptQuestion = shouldUseCtaPromptOnly ? "מה דעתך? שנשריין אימון ניסיון?" : "";

  let replyCore: string;
  let replyErrorCode: string | null = null;
  let isFallbackErrorReply = false;
  let didCallClaude = false;
  let replyModelUsed: string = CLAUDE_WHATSAPP_MODEL;

  if (matched && matched.reply) {
    // Static answer for a predefined quick-reply button
    replyCore = matched.reply;
    console.info(`[WA Webhook] Quick-reply match: "${matched.label}" → static response`);
  } else if (matchedPredefinedClosedLabel) {
    const txt =
      "קיבלתי את הבחירה שלך 👍 אם רצית להמשיך דרך התפריט, אפשר לבחור שוב מהאפשרויות שמופיעות בהודעה האחרונה. לשאלה פתוחה אפשר פשוט לכתוב לי כאן.";
    await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] Send predefined-choice guard reply failed:", e)
    );
    await logMessage({
      business_slug,
      role: "assistant",
      content: txt,
      model_used: "predefined_choice_guard",
      session_id: sessionId,
    });
    return;
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

    // Any free-form question → Claude/Gemini (עם היסטוריית סשן כדי להמשיך פלואו מכירה)
    const systemPrompt = buildSystemPrompt(knowledge, business_slug, "whatsapp", {
      sessionPhase: contactSessionPhase,
      trialRegistered: contactTrialRegistered === true,
    });
    const history = await fetchRecentSessionMessages({
      business_slug,
      session_id: sessionId,
      limit: 10,
    });
    const currentText = msg.text.trim();
    const claudeMessages =
      history.length > 0
        ? history.map((m) => ({ role: m.role, content: m.content }))
        : [];
    const lastHistoryMessage = claudeMessages[claudeMessages.length - 1];
    if (
      currentText &&
      (!lastHistoryMessage ||
        lastHistoryMessage.role !== "user" ||
        String(lastHistoryMessage.content ?? "").trim() !== currentText)
    ) {
      claudeMessages.push({ role: "user" as const, content: currentText });
    }
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
      const runGemini = async () => {
        const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? "";
        if (!geminiApiKey) throw new Error("Missing GEMINI_API_KEY");
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({
          model: GEMINI_WHATSAPP_MODEL,
          systemInstruction: systemPrompt,
        });
        const response = await model.generateContent({
          contents: claudeMessages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: String(m.content ?? "") }],
          })),
        });
        const text = response.response.text().trim();
        if (!text) throw new Error("empty response");
        return text;
      };

      try {
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

        if (!combinedText) {
          const types =
            Array.isArray((response as any)?.content)
              ? (response as any).content.map((b: any) => String(b?.type ?? "unknown")).join(",")
              : "no_content";
          const stopReason = String((response as any)?.stop_reason ?? "");
          const model = String((response as any)?.model ?? "");
          const id = String((response as any)?.id ?? "");
          console.warn("[WA Webhook] Claude empty_response", { id, model, stopReason, types });
          replyErrorCode = replyErrorCode ?? "empty_response";
          throw new Error("Claude empty response");
        }

        replyCore = combinedText;
      } catch (claudeError) {
        console.error(`[WA Webhook] Claude error for ${business_slug}, falling back to Gemini:`, claudeError);
        try {
          replyCore = await runGemini();
          replyModelUsed = GEMINI_WHATSAPP_MODEL;
        } catch (geminiError) {
          console.error(`[WA Webhook] Gemini fallback error for ${business_slug}:`, geminiError);
          replyCore = formatUserFacingClaudeError(geminiError);
          replyErrorCode = extractErrorCode(geminiError);
          isFallbackErrorReply = true;
          replyErrorCode = replyErrorCode ?? "claude_failed";
        }
      }
    } catch (e) {
      console.error(`[WA Webhook] Claude/Gemini setup error for ${business_slug}:`, e);
      replyCore = formatUserFacingClaudeError(e);
      replyErrorCode = extractErrorCode(e);
      isFallbackErrorReply = true;
      replyErrorCode = replyErrorCode ?? "claude_failed";
    }
  }

  const stripCandidates = [
    ...serviceSelectionLabels,
    ...buttons,
    ...quickLabels,
    ...(contactSessionPhase === "cta" ? ctaMenuLabelsForAi : []),
  ].filter(Boolean);

  const shouldStripModelNumberedChoices =
    !isFallbackErrorReply && (contactTrialRegistered === true || stripCandidates.length > 0);
  const replyCoreForMenu = shouldStripModelNumberedChoices
    ? stripNumberedChoiceLinesAnywhere(stripTrailingNumberedChoiceLines(replyCore), stripCandidates)
    : replyCore;
  const replyCoreClean = replyCoreForMenu
    .replaceAll(ZOE_WHATSAPP_MENU_FOOTER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  function normalizeLine(s: string): string {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function hasLineNearEnd(text: string, needle: string, lookbackLines = 6): boolean {
    const n = normalizeLine(needle);
    if (!n) return false;
    const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => normalizeLine(l)).filter(Boolean);
    const tail = lines.slice(Math.max(0, lines.length - lookbackLines));
    return tail.includes(n);
  }

  function dedupeConsecutiveDuplicateLines(text: string): string {
    const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    for (const line of lines) {
      const prev = out.length ? out[out.length - 1]! : null;
      if (prev != null && normalizeLine(prev) && normalizeLine(prev) === normalizeLine(line)) continue;
      out.push(line);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  let replyText = replyCoreClean;

  // If Claude failed and we sent a generic error, don't append menus/CTAs (keeps message clean).
  if (!isFallbackErrorReply) {
    const menuLabels = shouldReaskServiceSelection ? serviceSelectionLabels : buttons;
    const menuQuestion = shouldReaskServiceSelection ? serviceSelectionQuestion : ctaPromptQuestion;
    const shouldShowFooter = Boolean(menuQuestion) || menuLabels.length > 0;
    if (menuQuestion && !hasLineNearEnd(replyText, menuQuestion)) {
      replyText += `\n\n${menuQuestion}`;
    }
    const buttonsBlock =
      menuLabels.length > 0
        ? `\n\nבחרו אחת מהאפשרויות:\n${menuLabels
            .map((lbl, idx) => `${idx + 1}. ${lbl}`)
            .join("\n")}`
        : "";

    const ctaText =
      !shouldReaskServiceSelection && contactSessionPhase === "cta" && contactTrialRegistered !== true
        ? knowledge?.ctaText?.trim()
        : "";
    const ctaLink =
      !shouldReaskServiceSelection && contactSessionPhase === "cta" && contactTrialRegistered !== true
        ? knowledge?.ctaLink?.trim()
        : "";
    if (ctaText && ctaLink) {
      replyText += `\n\n${ctaText}: ${ctaLink}`;
    }

    replyText += buttonsBlock;
    if (shouldShowFooter) replyText += `\n\n${ZOE_WHATSAPP_MENU_FOOTER}`;
    replyText = dedupeConsecutiveDuplicateLines(replyText);
  }

  try {
    if (isFallbackErrorReply) {
      await sendWhatsAppMessage(msg.toNumber, msg.from, replyCore, accountSid, authToken);
    } else {
      const menuLabels = shouldReaskServiceSelection ? serviceSelectionLabels : buttons;
      const menuQuestion = shouldReaskServiceSelection ? serviceSelectionQuestion : ctaPromptQuestion;
      const ctaText =
        !shouldReaskServiceSelection && contactSessionPhase === "cta" && contactTrialRegistered !== true
          ? knowledge?.ctaText?.trim()
          : "";
      const ctaLink =
        !shouldReaskServiceSelection && contactSessionPhase === "cta" && contactTrialRegistered !== true
          ? knowledge?.ctaLink?.trim()
          : "";
      let body = replyCoreClean;
      if (menuQuestion && !hasLineNearEnd(body, menuQuestion)) {
        body += `\n\n${menuQuestion}`;
      }
      if (ctaText && ctaLink) {
        body += `\n\n${ctaText}: ${ctaLink}`;
      }
      body = dedupeConsecutiveDuplicateLines(body);
      const bodyForWA = stripNumberedChoiceLinesAnywhere(body, menuLabels);
      if (/\n\s*\d+\.\s+\S/m.test(bodyForWA)) {
        console.error("[WA Webhook] INVARIANT_VIOLATION: numbered choice lines would be sent to WhatsApp", {
          business_slug,
          sessionId,
        });
      }
      await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, bodyForWA, menuLabels, accountSid, authToken, {
        footerHint: menuLabels.length > 0 || Boolean(menuQuestion) ? ZOE_WHATSAPP_MENU_FOOTER : "",
      });

      const isFreeTextSalesFlowContinuation =
        msg.type === "text" &&
        Boolean(businessId) &&
        Boolean(knowledge?.salesFlowConfig) &&
        !isFallbackErrorReply &&
        !matched?.reply &&
        !matchedPredefinedClosedLabel &&
        !msg.metaInteractiveReplyId?.trim() &&
        !matchesTrialRegisteredMessage(msg.text.trim());

      if (isFreeTextSalesFlowContinuation && knowledge && businessId) {
        scheduleFlowContinuation({
          delayMs: 1500,
          phase: contactSessionPhase,
          contact: { flow_step: contactFlowStep },
          knowledge,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          salesFlowServices,
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
        });
      }
    }
  } catch (e) {
    console.error(`[WA Webhook] Send failed to ${msg.from}:`, e);
  }

  // Log assistant reply
  await logMessage({
    business_slug,
    role: "assistant",
    content: replyText,
    model_used: matched?.reply ? "static" : replyModelUsed,
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
