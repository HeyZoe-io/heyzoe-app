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
