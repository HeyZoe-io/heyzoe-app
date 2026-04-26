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
