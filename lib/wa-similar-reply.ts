const HELP_CLOSING_RE = /יש עוד משהו שאני יכולה לעזור לך (?:איתו|בו)\??/giu;

/** ליבת התשובה בלי שאלת סגירה, אימוג'י ופיסוק. */
export function similarReplyKey(text: string): string {
  return String(text ?? "")
    .replace(/למצטערי/g, "לצערי")
    .replace(/למצטער(?!ת)/g, "לצערי")
    .replace(HELP_CLOSING_RE, " ")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * אותה פסקה שכבר נשלחה, גם אם נוספה רק שאלת «יש עוד משהו».
 * משפט חדש מהותי אינו חזרה.
 */
export function repliesAreSimilar(previous: string, next: string): boolean {
  const a = similarReplyKey(previous);
  const b = similarReplyKey(next);
  if (a.length < 24 || b.length < 24) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 40 || !longer.includes(shorter)) return false;
  const extra = longer.replace(shorter, " ").replace(/\s+/g, " ").trim();
  return extra.length < 20;
}
