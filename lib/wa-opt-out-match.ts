/** הסרה מדיוור — רק הניסוחים האלה, כהודעה שלמה. */
export const WA_OPT_OUT_PHRASES = [
  "לא לשלוח לי יותר הודעות",
  "הסר",
  "להסיר אותי",
] as const;

function normalizeOptOutText(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/[""״׳']/g, "")
    .replace(/[?!.,;:~…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** true רק אם כל ההודעה היא אחד משלושת ניסוחי ההסרה. */
export function matchesOptOutKeyword(raw: string): boolean {
  const h = normalizeOptOutText(raw);
  if (!h) return false;
  return WA_OPT_OUT_PHRASES.some((phrase) => h === phrase);
}
