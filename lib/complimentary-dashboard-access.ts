/**
 * עסקים שמקבלים גישה מלאה לדשבורד בלי מנוי משולם (חשבונות דמו / פנימיים).
 * אל תרחיבו בלי אישור מוצר.
 */
const COMPLIMENTARY_DASHBOARD_SLUGS = new Set(["acrobyjoe"]);

export function hasComplimentaryDashboardAccess(slug: string | null | undefined): boolean {
  const s = String(slug ?? "")
    .trim()
    .toLowerCase();
  return s.length > 0 && COMPLIMENTARY_DASHBOARD_SLUGS.has(s);
}

/** זואי + דשבורד פעילים גם כש־is_active=false (חשבונות דמו). */
export function isBusinessServiceActive(
  slug: string | null | undefined,
  biz: {
    is_active?: boolean | null | unknown;
    cancellation_effective_at?: string | null | unknown;
  },
  nowMs: number = Date.now()
): boolean {
  if (hasComplimentaryDashboardAccess(slug)) return true;
  if (biz.is_active !== true) return false;

  const raw = biz.cancellation_effective_at;
  if (raw != null && raw !== "") {
    const endMs = new Date(String(raw)).getTime();
    if (Number.isFinite(endMs) && nowMs >= endMs) return false;
  }

  return true;
}
