/**
 * Leaf send-guard — no imports from whatsapp.ts / marketing-whatsapp (cycle-safe).
 * Every Graph/Twilio outbound must pass {@link assertWhatsAppOutboundAllowed}.
 */

/** הודעות בדיקה / debug — רק המספר הזה. לעולם לא מספר לקוח. */
export const HEYZOE_SAFE_TEST_PHONE = "972508318162";

/** קו זואי אדמין/שיווק — סטודיו לא שולח לכאן (פינג־פונג). */
export const HEYZOE_MARKETING_LINE_DIGITS = "97233824981";
export const HEYZOE_MARKETING_PHONE_NUMBER_ID = "1179786855208358";

export const WA_OUTBOUND_FLOOD_WINDOW_MS = 90_000;
/** אותו שולח+נמען — פלואו רגיל שולח כמה הודעות; לולאה עוברת את זה. */
export const WA_OUTBOUND_MAX_PER_PAIR = 12;
/** כל השולחים לאותו נמען בתהליך הזה. */
export const WA_OUTBOUND_MAX_PER_RECIPIENT = 20;

export type WhatsAppOutboundDecision =
  | { ok: true }
  | { ok: false; reason: string };

const sendTimesByPair = new Map<string, number[]>();
const sendTimesByRecipient = new Map<string, number[]>();

export function whatsappPeerDigits(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return `972${d.slice(1)}`;
  return d;
}

export function isHeyzoeSafeTestPhone(phone: string): boolean {
  return whatsappPeerDigits(phone) === HEYZOE_SAFE_TEST_PHONE;
}

export function assertHeyzoeSafeTestRecipient(phone: string, context: string): string {
  const digits = whatsappPeerDigits(phone);
  if (digits !== HEYZOE_SAFE_TEST_PHONE) {
    throw new Error(
      `[wa-send-guard] ${context}: refused — test/debug WhatsApp only to ${HEYZOE_SAFE_TEST_PHONE}, got ${digits || phone}`
    );
  }
  return digits;
}

function pruneTimestamps(times: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return times.filter((t) => t > cutoff);
}

function pairKey(fromPhoneNumberId: string, toDigits: string): string {
  return `${String(fromPhoneNumberId ?? "").trim()}|${toDigits}`;
}

/**
 * In-memory, fail-closed. Same Node isolate: a tight webhook loop dies here
 * even if DB flood count is lagging or unavailable.
 */
export function decideWhatsAppOutbound(input: {
  fromPhoneNumberId: string;
  to: string;
  nowMs?: number;
}): WhatsAppOutboundDecision {
  const fromId = String(input.fromPhoneNumberId ?? "").trim();
  const toDigits = whatsappPeerDigits(input.to);
  if (!toDigits) return { ok: false, reason: "missing_recipient" };

  if (toDigits === HEYZOE_MARKETING_LINE_DIGITS && fromId !== HEYZOE_MARKETING_PHONE_NUMBER_ID) {
    return { ok: false, reason: "refused_studio_to_marketing_line" };
  }

  const now = input.nowMs ?? Date.now();
  const pKey = pairKey(fromId, toDigits);
  const pairTimes = pruneTimestamps(sendTimesByPair.get(pKey) ?? [], now, WA_OUTBOUND_FLOOD_WINDOW_MS);
  const recipTimes = pruneTimestamps(
    sendTimesByRecipient.get(toDigits) ?? [],
    now,
    WA_OUTBOUND_FLOOD_WINDOW_MS
  );

  if (pairTimes.length >= WA_OUTBOUND_MAX_PER_PAIR) {
    return { ok: false, reason: "flood_pair" };
  }
  if (recipTimes.length >= WA_OUTBOUND_MAX_PER_RECIPIENT) {
    return { ok: false, reason: "flood_recipient" };
  }

  pairTimes.push(now);
  recipTimes.push(now);
  sendTimesByPair.set(pKey, pairTimes);
  sendTimesByRecipient.set(toDigits, recipTimes);
  return { ok: true };
}

export function assertWhatsAppOutboundAllowed(input: {
  fromPhoneNumberId: string;
  to: string;
}): void {
  const decision = decideWhatsAppOutbound(input);
  if (decision.ok) return;
  console.error("[wa-send-guard] blocked outbound WhatsApp", {
    reason: decision.reason,
    from: String(input.fromPhoneNumberId ?? "").trim(),
    to: whatsappPeerDigits(input.to),
  });
  throw new Error(`[wa-send-guard] blocked outbound: ${decision.reason}`);
}

export function resetWaSendGuardForTests(): void {
  sendTimesByPair.clear();
  sendTimesByRecipient.clear();
}
