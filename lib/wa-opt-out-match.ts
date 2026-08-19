import { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook";

/** מילות הסרה מרשימת דיוור — לא ביטול מנוי בסטודיו. */
export const WA_OPT_OUT_KEYWORDS = [
  "הסר",
  "הסרה",
  "הפסק",
  "בטל",
  "לא רוצה",
  "עצור",
  "stop",
  "unsubscribe",
  "remove",
  "cancel",
  "opt out",
  "optout",
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * מילת מפתח כמילה עצמאית (לא בתוך «מבטלים» / «cancellation»).
 * ביטויים עם רווח נשארים substring, כמו «לא רוצה» / «opt out».
 */
export function matchesOptOutKeyword(raw: string): boolean {
  const h = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!h) return false;
  for (const keyword of WA_OPT_OUT_KEYWORDS) {
    const needle = keyword.toLowerCase();
    if (!needle) continue;
    if (needle.includes(" ")) {
      if (h === needle || h.includes(needle)) return true;
      continue;
    }
    if (h === needle) return true;
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(?:$|[^\\p{L}\\p{N}])`, "u");
    if (re.test(h)) return true;
  }
  return false;
}

/** שאלת ביטול/הקפאה וכו׳ — לפלייבוק הסגור, לא להסרה מדיוור. */
export function shouldBypassOptOutForClosedPlaybook(raw: string): boolean {
  return detectClosedPlaybookIntent(raw) != null;
}
