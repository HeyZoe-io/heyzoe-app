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
