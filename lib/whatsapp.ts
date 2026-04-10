import { createHmac } from "crypto";

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
  toNumber: string;     // Twilio number e.g. "+14155238886" — used for channel lookup
  text: string;
  /** WhatsApp profile name (Twilio: ProfileName) if available */
  profileName?: string;
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

/** עטיפת טקסט לכיוון RTL בבועת ווטסאפ (אין API רשמי ליישור — רק בידי). */
export function formatWhatsAppRtlBody(text: string): string {
  const t = text ?? "";
  if (!t.trim()) return t;
  if (!/[\u0590-\u05FF]/.test(t)) return t;
  if (t.startsWith("\u2067") && t.endsWith("\u2069")) return t;
  // RLI … PDI: בידוד כיוון ימין-לשמאל לכל ההודעה (מעורב עברית, מספרים, קישורים)
  return `\u2067${t}\u2069`;
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

  // If `fromNumber` is a Meta phone_number_id (digits), prefer Meta Cloud API.
  const metaToken = resolveMetaAccessToken();
  const fromIsMetaId = /^[0-9]{6,}$/.test(fromNumber.trim());
  if (fromIsMetaId && metaToken) {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(fromNumber.trim())}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${metaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "text",
        text: { body: bodyText },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`[Meta WA send] ${res.status} ${res.statusText}: ${err}`);
    }
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
  caption?: string
): Promise<void> {
  const cleanUrl = mediaUrl.trim();
  if (!cleanUrl) return;

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
