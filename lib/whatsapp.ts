import { createHmac } from "crypto";

// ─── Env resolvers ────────────────────────────────────────────────────────────

export function resolveTwilioAccountSid(): string {
  return process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
}

export function resolveTwilioAuthToken(): string {
  return process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
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

// ─── Webhook payload types ────────────────────────────────────────────────────

export type WaIncomingText = {
  type: "text";
  messageId: string;
  from: string;         // e.g. "+972501234567"
  toNumber: string;     // Twilio number e.g. "+14155238886" — used for channel lookup
  text: string;
};

export type WaIncomingUnsupported = {
  type: "unsupported";
  messageId: string;
  from: string;
  toNumber: string;
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

  if (!messageSid || !rawFrom || !rawTo) return null;

  // Strip "whatsapp:" prefix
  const from     = rawFrom.replace(/^whatsapp:/i, "");
  const toNumber = rawTo.replace(/^whatsapp:/i, "");

  if (body) {
    return { type: "text", messageId: messageSid, from, toNumber, text: body };
  }
  if (numMedia > 0) {
    return { type: "unsupported", messageId: messageSid, from, toNumber };
  }

  return null;
}

// ─── Sending messages ─────────────────────────────────────────────────────────

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
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({
    From: `whatsapp:${fromNumber}`,
    To:   `whatsapp:${to}`,
    Body: text,
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
  if (caption && caption.trim()) body.set("Body", caption.trim());

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
