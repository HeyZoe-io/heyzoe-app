/**
 * Leaf send-guard — no imports from whatsapp.ts / marketing-whatsapp (cycle-safe).
 * Blocks the admin↔studio test ping-pong only. No per-second send caps.
 */

/** הודעות בדיקה / debug — רק המספר הזה. לעולם לא מספר לקוח. */
export const HEYZOE_SAFE_TEST_PHONE = "972508318162";

/** קו זואי אדמין/שיווק — סטודיו לא שולח לכאן (לולאת בדיקות). */
export const HEYZOE_MARKETING_LINE_DIGITS = "97233824981";
export const HEYZOE_MARKETING_PHONE_NUMBER_ID = "1179786855208358";

export type WhatsAppOutboundDecision =
  | { ok: true }
  | { ok: false; reason: string };

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

/** Block studio→marketing ping-pong. Does not cap how many customer messages we send. */
export function decideWhatsAppOutbound(input: {
  fromPhoneNumberId: string;
  to: string;
}): WhatsAppOutboundDecision {
  const fromId = String(input.fromPhoneNumberId ?? "").trim();
  const toDigits = whatsappPeerDigits(input.to);
  if (!toDigits) return { ok: false, reason: "missing_recipient" };

  if (toDigits === HEYZOE_MARKETING_LINE_DIGITS && fromId !== HEYZOE_MARKETING_PHONE_NUMBER_ID) {
    return { ok: false, reason: "refused_studio_to_marketing_line" };
  }

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
