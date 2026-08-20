/**
 * מנרמל מספרי טלפון ישראלים לפורם 972XXXXXXXXX (ללא +).
 * 0501234567 → 972501234567
 * +972501234567 → 972501234567
 */
export function normalizePhone(input: unknown): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return null;

  let normalized: string;
  if (digits.startsWith("972")) {
    normalized = digits;
  } else if (digits.startsWith("0")) {
    normalized = `972${digits.slice(1)}`;
  } else if (digits.length === 9 && /^5\d{8}$/.test(digits)) {
    normalized = `972${digits}`;
  } else {
    return null;
  }

  // 972 + 9 ספרות (5XXXXXXXX)
  if (!/^9725\d{8}$/.test(normalized)) return null;
  return normalized;
}

/**
 * Canonical 9-digit tail for matching WhatsApp E.164 against Arbox storage.
 * Strips non-digits, then last 9 (handles 972 / +972 / leading 0 / spaces / dashes).
 * Too short or no digits → null (treat as no-match).
 */
export function normalizeIsraeliPhoneTail(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

/**
 * Inbound that is only a phone number (digits + phone punctuation).
 * "1" / sentences with a number inside are not a bare phone.
 */
export function looksLikeBarePhoneMessage(raw: unknown): boolean {
  const t = String(raw ?? "").trim();
  if (!t || normalizeIsraeliPhoneTail(t) == null) return false;
  const compact = t.replace(/[\s\-().+]/g, "");
  return /^\d{9,15}$/.test(compact);
}

/** E.164 ל-Supabase Auth / Meta (+972...) */
export function normalizePhoneToE164(input: unknown): string | null {
  const digits = normalizePhone(input);
  return digits ? `+${digits}` : null;
}

/** סיומת session_id ב-webhook: wa_{phone_number_id}_{972...} (בלי +). */
export function waSessionPhoneKey(input: unknown): string {
  const normalized = normalizePhone(input);
  if (normalized) return normalized;
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits || String(input ?? "").trim();
}

/** session_id קנוני: wa_{phone_number_id}_{972...} */
export function buildWaSessionId(phoneNumberId: unknown, leadPhone: unknown): string {
  const pid = String(phoneNumberId ?? "").trim();
  const key = waSessionPhoneKey(leadPhone);
  return pid && key ? `wa_${pid}_${key}` : "";
}

/** וריאנטים לחיפוש messages.session_id (תאימות לשורות ישנות עם + ב-session_id). */
export function waSessionIdLookupVariants(phoneNumberId: unknown, leadPhone: unknown): string[] {
  const pid = String(phoneNumberId ?? "").trim();
  if (!pid) return [];
  const trimmed = String(leadPhone ?? "").trim();
  const key = waSessionPhoneKey(leadPhone);
  const out = new Set<string>();
  if (key) out.add(`wa_${pid}_${key}`);
  if (trimmed) out.add(`wa_${pid}_${trimmed}`);
  if (key) out.add(`wa_${pid}_+${key}`);
  return [...out].filter(Boolean);
}

/** Parse `wa_{phone_number_id}_{leadPhone}`. */
export function waSessionIdParts(sessionId: string): { phoneNumberId: string; phone: string } | null {
  const sid = String(sessionId ?? "").trim();
  if (!sid.startsWith("wa_")) return null;
  const rest = sid.slice(3);
  const idx = rest.indexOf("_");
  if (idx < 0) return null;
  const phoneNumberId = rest.slice(0, idx).trim();
  const phone = rest.slice(idx + 1).trim();
  if (!phoneNumberId || !phone) return null;
  return { phoneNumberId, phone };
}

/** All session_id spellings for one WhatsApp thread (+972 vs 972). */
export function waSessionIdVariantsFromSessionId(sessionId: string): string[] {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return [];
  const parts = waSessionIdParts(sid);
  if (!parts) return [sid];
  return [...new Set([sid, ...waSessionIdLookupVariants(parts.phoneNumberId, parts.phone)])];
}

/** וריאנטים לחיפוש contacts.phone (+972..., 972..., וכו'). */
export function contactPhoneLookupVariants(input: unknown): string[] {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return [];

  const normalized = normalizePhone(trimmed);
  const digits = trimmed.replace(/\D/g, "");
  const out = new Set<string>();

  out.add(trimmed);
  if (trimmed.startsWith("+")) out.add(trimmed.slice(1));
  if (digits) out.add(digits);
  if (normalized) {
    out.add(normalized);
    out.add(`+${normalized}`);
  }

  return [...out].filter(Boolean);
}
