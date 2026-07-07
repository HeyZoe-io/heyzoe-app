/** fallback בלבד — משמש רק כש-billing_anchor_day הוא NULL (לא ברירת המחדל הרגילה). */
export const CANCELLATION_GRACE_DAYS = 30;

/** יום עוגן מיום התשלום הראשון — חסום ל-28 (חודשים קצרים). */
export function billingAnchorDayFromPaymentDate(d: Date = new Date()): number {
  return Math.min(d.getDate(), 28);
}

function parseBillingAnchorDay(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const day = Math.floor(n);
  if (day < 1 || day > 28) return null;
  return day;
}

/** המופע הבא של יום העוגן strictly אחרי `from` (תאריך סיום תקופה ששולמה). */
function nextBillingAnchorAfter(from: Date, anchorDay: number): Date {
  const anchor = Math.min(Math.max(Math.floor(anchorDay), 1), 28);
  const y = from.getFullYear();
  const m = from.getMonth();
  let candidate = new Date(y, m, anchor, 0, 0, 0, 0);
  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(y, m + 1, anchor, 0, 0, 0, 0);
  }
  return candidate;
}

/**
 * תאריך סיום גישה לאחר בקשת ביטול — מבוסס billing_anchor_day.
 * fallback: now+30 אם העוגן חסר (לא אמור לקרות ללקוח משלם).
 */
export function addCancellationGracePeriod(
  from: Date = new Date(),
  billingAnchorDay?: number | null | unknown
): Date {
  const anchor = parseBillingAnchorDay(billingAnchorDay);
  if (anchor == null) {
    return new Date(from.getTime() + CANCELLATION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  }
  return nextBillingAnchorAfter(from, anchor);
}
