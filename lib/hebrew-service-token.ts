/**
 * קיפול עברי לשמות אימון בקטלוג: ה' הידיעה / ב/ל, וסיומות ים/ות
 * («מתחילים» ↔ «מתחילות»). לא מקפלים מילים קצרות («נשים», «יוגה»).
 */

export function foldHebrewServiceToken(raw: string): string {
  let t = String(raw ?? "").trim();
  if (!t) return t;
  t = t.replace(/^[הבל]/u, "");
  if (t.length >= 5 && /(ים|ות)$/u.test(t)) {
    t = t.replace(/(ים|ות)$/u, "");
  }
  return t;
}

export function foldHebrewServiceBlob(raw: string): string {
  return String(raw ?? "")
    .split(/\s+/)
    .map((w) => foldHebrewServiceToken(w))
    .filter(Boolean)
    .join(" ");
}
