import { createHash, createHmac } from "crypto";

// ─── Env resolvers ────────────────────────────────────────────────────────────

export function resolveTwilioAccountSid(): string {
  return process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
}

export function resolveTwilioAuthToken(): string {
  return process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
}

export function resolveMetaAccessToken(): string {
  return (
    process.env.META_ACCESS_TOKEN?.trim() ||
    process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ||
    ""
  );
}

/** App secret for X-Hub-Signature-256 (Meta WhatsApp webhooks). Prefer WHATSAPP_APP_SECRET; META_APP_SECRET kept as fallback. */
export function resolveMetaAppSecret(): string {
  return (
    process.env.WHATSAPP_APP_SECRET?.trim() ||
    process.env.META_APP_SECRET?.trim() ||
    ""
  );
}

export function resolveMetaVerifyToken(): string {
  return process.env.META_VERIFY_TOKEN?.trim() ?? "";
}

// ─── Signature verification ───────────────────────────────────────────────────

/**
 * Verifies X-Twilio-Signature.
 * Twilio signs: HMAC-SHA1(authToken, url + sortedParams) → Base64
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken || !signature) return false;

  const sortedKeys = Object.keys(params).sort();
  let str = url;
  for (const key of sortedKeys) {
    str += key + (params[key] ?? "");
  }

  const expected = createHmac("sha1", authToken).update(str, "utf8").digest("base64");

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verifies Meta X-Hub-Signature-256 header:
 * sha256=HMAC_SHA256(appSecret, rawBody)
 */
export function verifyMetaSignature256(
  appSecret: string,
  signatureHeader: string,
  rawBody: string
): boolean {
  const sig = String(signatureHeader ?? "").trim();
  if (!appSecret || !sig.startsWith("sha256=")) return false;
  const received = sig.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (expected.length !== received.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Webhook payload types ────────────────────────────────────────────────────

export type WaIncomingText = {
  type: "text";
  messageId: string;
  from: string;         // e.g. "+972501234567"
  toNumber: string;     // Twilio E.164 or Meta phone_number_id (digits)
  text: string;
  /** WhatsApp profile name (Twilio: ProfileName) if available */
  profileName?: string;
  /** Meta interactive reply `id` — use with {@link resolveMetaInteractiveLabel} for full label */
  metaInteractiveReplyId?: string;
};

export type WaIncomingUnsupported = {
  type: "unsupported";
  messageId: string;
  from: string;
  toNumber: string;
  /** WhatsApp profile name (Twilio: ProfileName) if available */
  profileName?: string;
};

export type WaIncomingMessage = WaIncomingText | WaIncomingUnsupported;

/**
 * Parses a Twilio form-encoded webhook payload.
 * Twilio sends one message per request (unlike Meta which batches).
 */
export function parseTwilioWebhook(params: Record<string, string>): WaIncomingMessage | null {
  const messageSid = params.MessageSid ?? "";
  const rawFrom    = params.From ?? "";  // "whatsapp:+972501234567"
  const rawTo      = params.To ?? "";    // "whatsapp:+14155238886"
  const body       = (params.Body ?? "").trim();
  const numMedia   = Number(params.NumMedia ?? "0");
  const profileName = (params.ProfileName ?? "").trim();

  if (!messageSid || !rawFrom || !rawTo) return null;

  // Strip "whatsapp:" prefix
  const from     = rawFrom.replace(/^whatsapp:/i, "");
  const toNumber = rawTo.replace(/^whatsapp:/i, "");

  if (body) {
    return {
      type: "text",
      messageId: messageSid,
      from,
      toNumber,
      text: body,
      profileName: profileName || undefined,
    };
  }
  if (numMedia > 0) {
    return {
      type: "unsupported",
      messageId: messageSid,
      from,
      toNumber,
      profileName: profileName || undefined,
    };
  }

  return null;
}

function normalizeMetaE164(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.startsWith("+") ? t : `+${t}`;
}

/** `fromNumber` is Meta Cloud API when it is the numeric phone_number_id (not E.164). */
export function isMetaCloudPhoneNumberId(fromNumber: string): boolean {
  return /^[0-9]{6,}$/.test(fromNumber.trim());
}

const META_BTN_TITLE_MAX = 20;
const META_LIST_ROW_TITLE_MAX = 24;
const META_LIST_SECTION_TITLE_MAX = 24;
const META_LIST_ACTION_BUTTON_MAX = 20;
const META_INTERACTIVE_BODY_MAX = 1024;
const META_LIST_ROWS_MAX = 10;
const META_INTERACTIVE_FOOTER_MAX = 60;

function truncateMetaByCodePoints(s: string, maxChars: number): string {
  const chars = [...(s ?? "")];
  if (chars.length <= maxChars) return s;
  return chars.slice(0, Math.max(0, maxChars - 1)).join("") + "…";
}

function truncateMetaFooterText(s: string): string {
  return truncateMetaByCodePoints(s.trim(), META_INTERACTIVE_FOOTER_MAX);
}

/** Stable id for interactive reply; decode with {@link metaInteractiveDecodeReplyId} or {@link resolveMetaInteractiveLabel}. */
export function metaReplyIdFromLabel(label: string): string {
  const raw = label.trim();
  if (!raw) return "empty";
  const b64 = Buffer.from(raw, "utf8").toString("base64url");
  if (b64.length <= 220) return `z:${b64}`;
  const h = createHash("sha256").update(raw, "utf8").digest("hex");
  return `h:${h}`;
}

export function metaInteractiveDecodeReplyId(id: string): string | null {
  const t = id.trim();
  if (!t.startsWith("z:")) return null;
  try {
    return Buffer.from(t.slice(2), "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** Resolve full menu label from Meta `id` + visible `title` + known candidates (for hashed ids / truncation). */
export function resolveMetaInteractiveLabel(
  id: string,
  title: string,
  candidates: string[]
): string {
  const decoded = metaInteractiveDecodeReplyId(id);
  if (decoded) return decoded;
  const tid = id.trim();
  if (tid.startsWith("h:")) {
    const hex = tid.slice(2);
    for (const c of candidates) {
      if (createHash("sha256").update(c.trim(), "utf8").digest("hex") === hex) return c.trim();
    }
  }
  const ti = title.trim();
  if (ti) {
    const exact = candidates.find((c) => c.trim() === ti);
    if (exact) return exact.trim();
    const fold = (s: string) => s.trim().toLowerCase();
    const hit = candidates.find((c) => fold(c) === fold(ti));
    if (hit) return hit.trim();
  }
  return ti || tid;
}

function parseOneMetaMessage(value: Record<string, unknown>, m: Record<string, unknown>): WaIncomingMessage | null {
  const phoneNumberId = String((value.metadata as Record<string, unknown> | undefined)?.phone_number_id ?? "").trim();
  const fromRaw = String(m.from ?? "").trim();
  const from = normalizeMetaE164(fromRaw);
  const messageId =
    String(m.id ?? "").trim() || `meta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const firstContact = contacts[0] as Record<string, unknown> | undefined;
  const profileName = String(
    (firstContact?.profile as Record<string, unknown> | undefined)?.name ?? ""
  ).trim();
  const type = String(m.type ?? "").trim();

  if (!from || !phoneNumberId) return null;

  if (type === "text") {
    const text = String((m.text as Record<string, unknown> | undefined)?.body ?? "").trim();
    if (!text) return null;
    return {
      type: "text",
      messageId,
      from,
      toNumber: phoneNumberId,
      text,
      profileName: profileName || undefined,
    };
  }

  if (type === "interactive") {
    const inter = m.interactive as Record<string, unknown> | undefined;
    const itype = String(inter?.type ?? "").trim();
    let replyId = "";
    let title = "";
    if (itype === "button_reply") {
      const br = inter?.button_reply as Record<string, unknown> | undefined;
      replyId = String(br?.id ?? "").trim();
      title = String(br?.title ?? "").trim();
    } else if (itype === "list_reply") {
      const lr = inter?.list_reply as Record<string, unknown> | undefined;
      replyId = String(lr?.id ?? "").trim();
      title = String(lr?.title ?? "").trim();
    }
    const text =
      metaInteractiveDecodeReplyId(replyId) ||
      title ||
      (replyId ? replyId : "");
    if (!text) return null;
    return {
      type: "text",
      messageId,
      from,
      toNumber: phoneNumberId,
      text,
      profileName: profileName || undefined,
      metaInteractiveReplyId: replyId || undefined,
    };
  }

  return {
    type: "unsupported",
    messageId,
    from,
    toNumber: phoneNumberId,
    profileName: profileName || undefined,
  };
}

/**
 * Parses Meta Cloud API webhook payload (WhatsApp Business Account).
 * Meta may batch multiple entry/changes/messages; we return the first inbound message we can handle.
 */
export function parseMetaWebhook(payload: unknown): WaIncomingMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account") return null;
  const entries = Array.isArray(root.entry) ? root.entry : [];
  for (const entry of entries) {
    const ent = entry as Record<string, unknown>;
    const changes = Array.isArray(ent.changes) ? ent.changes : [];
    for (const change of changes) {
      const ch = change as Record<string, unknown>;
      const value = ch.value;
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const msgs = Array.isArray(v.messages) ? v.messages : [];
      for (const rawMsg of msgs) {
        if (!rawMsg || typeof rawMsg !== "object") continue;
        const parsed = parseOneMetaMessage(v, rawMsg as Record<string, unknown>);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

/** Why {@link parseMetaWebhook} returned null (for logs; avoids silent drops). */
export function explainMetaWebhookSkip(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "payload is not a JSON object";
  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account") {
    const o = root.object;
    return `object is not whatsapp_business_account (${typeof o === "string" ? `"${o}"` : String(o)})`;
  }
  const entries = Array.isArray(root.entry) ? root.entry : [];
  if (entries.length === 0) return "entry array missing or empty";

  let sawValue = false;
  let messageCount = 0;
  let statusCount = 0;
  let sawAnyChange = false;

  for (const entry of entries) {
    const ent = entry as Record<string, unknown>;
    const changes = Array.isArray(ent.changes) ? ent.changes : [];
    if (changes.length === 0) continue;
    sawAnyChange = true;
    for (const change of changes) {
      const ch = change as Record<string, unknown>;
      const value = ch.value;
      if (!value || typeof value !== "object") continue;
      sawValue = true;
      const v = value as Record<string, unknown>;
      const msgs = Array.isArray(v.messages) ? v.messages : [];
      const statuses = Array.isArray(v.statuses) ? v.statuses : [];
      messageCount += msgs.length;
      statusCount += statuses.length;
      for (const rawMsg of msgs) {
        if (!rawMsg || typeof rawMsg !== "object") continue;
        const m = rawMsg as Record<string, unknown>;
        const phoneNumberId = String(
          (v.metadata as Record<string, unknown> | undefined)?.phone_number_id ?? ""
        ).trim();
        const from = normalizeMetaE164(String(m.from ?? ""));
        const typ = String(m.type ?? "").trim();
        if (!phoneNumberId) return "message missing metadata.phone_number_id";
        if (!from) return "message missing from";
        if (typ === "text") {
          const body = String((m.text as Record<string, unknown> | undefined)?.body ?? "").trim();
          if (!body) return "text message with empty body";
        }
      }
    }
  }

  if (!sawAnyChange) return "no changes in any entry";
  if (!sawValue) return "no change.value objects in payload";
  if (messageCount === 0 && statusCount > 0) {
    return `status-only webhook (${statusCount} status(es), no messages — normal for delivery receipts)`;
  }
  if (messageCount === 0) return "no messages in webhook payload";
  return "messages present but none matched parser (unexpected shape?)";
}

// ─── Sending messages ─────────────────────────────────────────────────────────

/**
 * Strips trailing blank lines and lines shaped like "1. …" / "2. …" from the model
 * so we do not duplicate choice lists when sending Meta interactive or Twilio numbered menus.
 */
export function stripTrailingNumberedChoiceLines(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let end = lines.length;
  while (end > 0) {
    const t = lines[end - 1].trim();
    if (t === "") {
      end--;
      continue;
    }
    if (/^\d+\.\s+\S/.test(t)) {
      end--;
      continue;
    }
    break;
  }
  return lines.slice(0, end).join("\n").trimEnd();
}

/** עטיפת טקסט לכיוון RTL בבועת ווטסאפ (אין API רשמי ליישור — רק בידי). */
export function formatWhatsAppRtlBody(text: string): string {
  const t = text ?? "";
  if (!t.trim()) return t;
  if (!/[\u0590-\u05FF]/.test(t)) return t;
  if (t.startsWith("\u2067") && t.endsWith("\u2069")) return t;
  // RLI … PDI: בידוד כיוון ימין-לשמאל לכל ההודעה (מעורב עברית, מספרים, קישורים)
  return `\u2067${t}\u2069`;
}

function truncateInteractiveBody(text: string): string {
  const t = text.trim();
  if (t.length <= META_INTERACTIVE_BODY_MAX) return t;
  return [...t].slice(0, META_INTERACTIVE_BODY_MAX - 1).join("") + "…";
}

/**
 * Builds Meta Cloud API `interactive` payload: 2–3 options → reply buttons; 4+ → list (max 10 rows).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 */
export function buildMetaInteractivePayload(
  bodyText: string,
  optionLabels: string[],
  footerText?: string
): { type: "interactive"; interactive: Record<string, unknown> } | null {
  const labels = optionLabels.map((l) => l.trim()).filter(Boolean);
  if (labels.length < 2) return null;

  const capped = labels.slice(0, META_LIST_ROWS_MAX);
  const body = formatWhatsAppRtlBody(truncateInteractiveBody(bodyText.trim() || "\u200e"));
  const footer =
    footerText?.trim() ?
      { text: formatWhatsAppRtlBody(truncateMetaFooterText(footerText)) }
    : undefined;

  if (capped.length <= 3) {
    return {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        ...(footer ? { footer } : {}),
        action: {
          buttons: capped.map((label) => ({
            type: "reply",
            reply: {
              id: metaReplyIdFromLabel(label),
              title: truncateMetaByCodePoints(label, META_BTN_TITLE_MAX),
            },
          })),
        },
      },
    };
  }

  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      ...(footer ? { footer } : {}),
      action: {
        button: truncateMetaByCodePoints("בחר אפשרות", META_LIST_ACTION_BUTTON_MAX),
        sections: [
          {
            title: truncateMetaByCodePoints("אפשרויות", META_LIST_SECTION_TITLE_MAX),
            rows: capped.map((label) => ({
              id: metaReplyIdFromLabel(label),
              title: truncateMetaByCodePoints(label, META_LIST_ROW_TITLE_MAX),
            })),
          },
        ],
      },
    },
  };
}

export type MetaWhatsAppOutgoing =
  | { type: "text"; text: string }
  | { type: "interactive"; interactive: Record<string, unknown> };

/**
 * Sends a WhatsApp Cloud API message (plain text or interactive) from a phone_number_id.
 */
export async function sendMetaWhatsAppMessage(
  phoneNumberId: string,
  toE164: string,
  outgoing: MetaWhatsAppOutgoing
): Promise<void> {
  const metaToken = resolveMetaAccessToken();
  if (!metaToken) {
    throw new Error("[Meta WA send] missing META_ACCESS_TOKEN / WHATSAPP_SYSTEM_TOKEN");
  }
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId.trim())}/messages`;
  const to = toE164.replace(/^\+/, "");
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: outgoing.type,
  };
  if (outgoing.type === "text") {
    body.text = { body: formatWhatsAppRtlBody(outgoing.text) };
  } else {
    body.interactive = outgoing.interactive;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${metaToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`[Meta WA send] ${res.status} ${res.statusText}: ${err}`);
  }
}

/**
 * Twilio: numbered list + optional footer. Meta: interactive buttons (2–3 opts) or list (4+), else plain text.
 */
export async function sendWhatsAppTextOrMenu(
  fromNumber: string,
  to: string,
  bodyText: string,
  menuOptionLabels: string[],
  accountSid: string,
  authToken: string,
  opts?: { footerHint?: string }
): Promise<void> {
  const labels = menuOptionLabels.map((l) => l.trim()).filter(Boolean);
  const footer = (opts?.footerHint ?? "").trim();
  const withFooterPlain = (base: string) => {
    const b = base.trim();
    return footer ? `${b}\n\n${footer}` : b;
  };

  if (isMetaCloudPhoneNumberId(fromNumber) && resolveMetaAccessToken()) {
    const baseBody = bodyText.trim();
    if (labels.length >= 2) {
      const interactive = buildMetaInteractivePayload(baseBody, labels, footer || undefined);
      if (interactive) {
        try {
          await sendMetaWhatsAppMessage(fromNumber, to, interactive);
          return;
        } catch (e) {
          console.warn("[Meta WA] interactive send failed, falling back to plain text:", e);
        }
      }
    }
    await sendMetaWhatsAppMessage(fromNumber, to, {
      type: "text",
      text: withFooterPlain(baseBody),
    });
    return;
  }

  let text = bodyText.trim();
  if (labels.length > 0) {
    text += `\n\nבחרו אחת מהאפשרויות:\n${labels.map((lbl, idx) => `${idx + 1}. ${lbl}`).join("\n")}`;
  }
  text = withFooterPlain(text);
  await sendWhatsAppMessage(fromNumber, to, text, accountSid, authToken);
}

/**
 * Sends a WhatsApp text message via Twilio Messaging API.
 * fromNumber: the Twilio WhatsApp number e.g. "+14155238886"
 * to: recipient's number e.g. "+972501234567"
 */
export async function sendWhatsAppMessage(
  fromNumber: string,
  to: string,
  text: string,
  accountSid: string,
  authToken: string
): Promise<void> {
  const bodyText = formatWhatsAppRtlBody(text);

  const metaToken = resolveMetaAccessToken();
  if (isMetaCloudPhoneNumberId(fromNumber) && metaToken) {
    await sendMetaWhatsAppMessage(fromNumber, to, { type: "text", text });
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({
    From: `whatsapp:${fromNumber}`,
    To:   `whatsapp:${to}`,
    Body: bodyText,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`[Twilio send] ${res.status} ${res.statusText}: ${err}`);
  }
}

export async function sendWhatsAppMediaMessage(
  fromNumber: string,
  to: string,
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  caption?: string,
  mediaKind?: "image" | "video"
): Promise<void> {
  const cleanUrl = mediaUrl.trim();
  if (!cleanUrl) return;

  const metaToken = resolveMetaAccessToken();
  if (isMetaCloudPhoneNumberId(fromNumber) && metaToken) {
    const toDigits = to.replace(/^\+/, "");
    const apiUrl = `https://graph.facebook.com/v21.0/${encodeURIComponent(fromNumber.trim())}/messages`;
    const cap = caption?.trim() ? formatWhatsAppRtlBody(caption.trim()) : undefined;
    const isVideo =
      mediaKind === "video" ||
      /\.(mp4|mov|webm)(\?|$)/i.test(cleanUrl) ||
      /video\//i.test(cleanUrl);
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toDigits,
      type: isVideo ? "video" : "image",
    };
    if (isVideo) {
      payload.video = cap ? { link: cleanUrl, caption: cap } : { link: cleanUrl };
    } else {
      payload.image = cap ? { link: cleanUrl, caption: cap } : { link: cleanUrl };
    }
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${metaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`[Meta WA send media] ${res.status} ${res.statusText}: ${err}`);
    }
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({
    From: `whatsapp:${fromNumber}`,
    To: `whatsapp:${to}`,
    MediaUrl: cleanUrl,
  });
  if (caption && caption.trim()) body.set("Body", formatWhatsAppRtlBody(caption.trim()));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`[Twilio send media] ${res.status} ${res.statusText}: ${err}`);
  }
}
