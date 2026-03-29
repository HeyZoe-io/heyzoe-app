import { createHmac } from "crypto";

export const WA_API_VERSION = "v21.0" as const;
export const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;

// ─── Env resolvers ────────────────────────────────────────────────────────────

export function resolveWaVerifyToken(): string {
  return process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "";
}

export function resolveWaAppSecret(): string {
  return process.env.WHATSAPP_APP_SECRET?.trim() ?? "";
}

export function resolveWaSystemToken(): string {
  return process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
}

// ─── Webhook signature verification ──────────────────────────────────────────

/**
 * Verifies the X-Hub-Signature-256 header from Meta.
 * Returns true if the payload matches the HMAC-SHA256 signature.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signatureHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Webhook payload types ────────────────────────────────────────────────────

export type WaIncomingText = {
  type: "text";
  messageId: string;
  from: string;          // sender's phone number e.g. "972501234567"
  phoneNumberId: string; // business's Meta phone number ID
  text: string;
};

export type WaIncomingUnsupported = {
  type: "unsupported";
  messageId: string;
  from: string;
  phoneNumberId: string;
};

export type WaIncomingMessage = WaIncomingText | WaIncomingUnsupported;

/**
 * Parses a raw Meta webhook payload and extracts all incoming messages.
 * Silently ignores status updates, read receipts, and malformed entries.
 */
export function parseIncomingMessages(body: unknown): WaIncomingMessage[] {
  const results: WaIncomingMessage[] = [];

  if (!body || typeof body !== "object") return results;
  const root = body as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account") return results;

  const entries = Array.isArray(root.entry) ? root.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value || typeof value !== "object") continue;

      const metadata = (value as Record<string, unknown>).metadata;
      const phoneNumberId = String(
        (metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).phone_number_id : null) ?? ""
      );
      if (!phoneNumberId) continue;

      const messages = Array.isArray((value as Record<string, unknown>).messages)
        ? (value as Record<string, unknown>).messages as unknown[]
        : [];

      for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        const m = msg as Record<string, unknown>;
        const messageId = String(m.id ?? "");
        const from = String(m.from ?? "");
        if (!messageId || !from) continue;

        if (m.type === "text" && m.text && typeof m.text === "object") {
          const textBody = String((m.text as Record<string, unknown>).body ?? "").trim();
          if (textBody) {
            results.push({ type: "text", messageId, from, phoneNumberId, text: textBody });
          }
        } else {
          results.push({ type: "unsupported", messageId, from, phoneNumberId });
        }
      }
    }
  }

  return results;
}

// ─── Sending messages ─────────────────────────────────────────────────────────

/**
 * Sends a WhatsApp text message via the Meta Cloud API.
 * phoneNumberId: the business's Meta phone number ID
 * to: recipient's phone number in E.164 format without "+" (e.g. "972501234567")
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  systemToken: string
): Promise<void> {
  const url = `${WA_BASE_URL}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${systemToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`[WhatsApp send] ${res.status} ${res.statusText}: ${err}`);
  }
}

/**
 * Marks an incoming message as read (removes the "delivered" double-tick).
 * Best-effort — failures are logged but not thrown.
 */
export async function markMessageRead(
  phoneNumberId: string,
  messageId: string,
  systemToken: string
): Promise<void> {
  const url = `${WA_BASE_URL}/${phoneNumberId}/messages`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${systemToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch (e) {
    console.warn("[WhatsApp markRead] failed:", e);
  }
}
