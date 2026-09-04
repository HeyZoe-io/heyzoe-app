import { canonicalContactPhone, normalizePhone, waSessionIdParts } from "@/lib/phone-normalize";

/**
 * messages has no contact_id. Join key is the phone suffix of a WhatsApp session_id.
 * Canonical: wa_{phoneNumberId}_{9725...}
 * Legacy:    wa_{phoneNumberId}_+9725...
 * Non-wa rows (dashboard / events) must not be treated as audience members.
 */
export type WaSessionPhoneParse =
  | { ok: true; phone: string }
  | { ok: false; reason: "empty" | "not_wa" | "unparseable" };

export function phoneFromWaMessageSessionId(sessionId: unknown): WaSessionPhoneParse {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return { ok: false, reason: "empty" };
  if (!sid.startsWith("wa_")) return { ok: false, reason: "not_wa" };
  const parts = waSessionIdParts(sid);
  if (!parts?.phone) return { ok: false, reason: "unparseable" };
  const phone = canonicalContactPhone(parts.phone) ?? normalizePhone(parts.phone);
  if (!phone) return { ok: false, reason: "unparseable" };
  return { ok: true, phone };
}
