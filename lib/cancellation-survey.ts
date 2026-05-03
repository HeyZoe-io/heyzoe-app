/** סיבות ביטול מנוי — ערכים שנשמרים בשדה reason ב-DB ובולידציה ב-API */

export const CANCELLATION_SURVEY_REASONS = [
  "המחיר גבוה מדי",
  "הפיצ'רים לא הספיקו לצרכים שלי",
  "קשה לשימוש",
  "לא צריך את השירות כרגע",
  "עברתי לפתרון אחר",
  "אחר",
] as const;

export type CancellationSurveyReason = (typeof CANCELLATION_SURVEY_REASONS)[number];

const REQUIRES_DETAIL: ReadonlySet<string> = new Set([
  "הפיצ'רים לא הספיקו לצרכים שלי",
  "עברתי לפתרון אחר",
  "אחר",
]);

export function cancellationSurveyRequiresDetail(reason: string): boolean {
  return REQUIRES_DETAIL.has(String(reason ?? "").trim());
}

export function isAllowedCancellationReason(reason: string): reason is CancellationSurveyReason {
  return (CANCELLATION_SURVEY_REASONS as readonly string[]).includes(String(reason ?? "").trim());
}

/** תווית לשדה הפירוט לפי סיבה */
export function cancellationSurveyDetailLabel(reason: string): string {
  const r = String(reason ?? "").trim();
  if (r === "הפיצ'רים לא הספיקו לצרכים שלי") return "אילו יכולות היו חסרות לך?";
  if (r === "עברתי לפתרון אחר") return "נשמח לשמוע לאיזה פתרון, על מנת להשתפר";
  if (r === "אחר") return "נשמח לשמוע פירוט";
  return "";
}
