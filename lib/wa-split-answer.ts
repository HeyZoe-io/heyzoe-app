/**
 * ניקוי תשובת AI כשהמערכת שולחת CTA / המשך פלואו / תפריט כפתורים בהודעה נפרדת.
 */

export function normalizeLineForMenuEcho(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeChunk(s: string): string {
  return normalizeLineForMenuEcho(s);
}

/** מסיר שורות שמחקות תפריט כפתורים (שאלה + תוויות) מתשובת AI */
export function stripMenuEchoFromAnswer(
  text: string,
  menuQuestion: string,
  menuLabels: string[]
): string {
  const qNorm = normalizeLineForMenuEcho(menuQuestion);
  const labelNorms = (menuLabels ?? []).map((l) => normalizeLineForMenuEcho(l)).filter(Boolean);
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const n = normalizeLineForMenuEcho(line);
    if (!n) {
      out.push(line);
      continue;
    }
    if (qNorm && n === qNorm) continue;
    if (labelNorms.length && labelNorms.some((x) => x === n)) continue;
    if (n === "כפתורים" || n === "כפתורים:" || n === "אפשרויות" || n === "אפשרויות:") continue;
    if (/^בחרו (אחת|אחד) מהאפשרויות:?$/u.test(line.trim())) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** האם קטע טקסט נראה כמו שאלת המשך (לא מענה על שאלת הליד) */
export function looksLikeFollowUpQuestion(chunk: string): boolean {
  const t = String(chunk ?? "").trim();
  if (!t) return false;
  if (t.length > 200) return false;
  if (/\?\s*$/.test(t)) return true;
  return /^(מה|איך|האם|מי|איפה|מתי|למה|רוצה|רוצים|רוצה ל|יש לך|יש לכם|ספר|ספרי|ספרו|איך ה|נשמע לך|מה דעתך|מה עוד|אפשר ל|רוצה ש)/iu.test(
    t
  );
}

/** מסיר שאלת המשך מהסוף — לפני שליחת הודעת הנעה/פלואו נפרדת */
export function stripTrailingFollowUpQuestion(text: string): string {
  let s = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return s;

  let parts = s.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  while (parts.length > 1 && looksLikeFollowUpQuestion(parts[parts.length - 1]!)) {
    parts.pop();
  }
  s = parts.join("\n\n");

  const lines = s.split("\n");
  while (lines.length > 1 && looksLikeFollowUpQuestion(lines[lines.length - 1]!)) {
    lines.pop();
  }
  s = lines.join("\n").trim();

  if (s.includes("?")) {
    const sentences = s.split(/(?<=[.!?…])\s+/u).map((x) => x.trim()).filter(Boolean);
    if (sentences.length > 1 && looksLikeFollowUpQuestion(sentences[sentences.length - 1]!)) {
      s = sentences.slice(0, -1).join(" ").trim();
    }
  }

  return s;
}

export const REGISTERED_OPEN_QUESTION_HELP_CLOSING =
  "יש עוד משהו שאני יכולה לעזור לך בו?";

/** אחרי «נרשמתי» — מוסיף שאלת סיום אם חסרה */
export function ensureRegisteredOpenQuestionClosing(text: string): string {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return REGISTERED_OPEN_QUESTION_HELP_CLOSING;
  if (/יש עוד משהו.*(עזור|לעזור)/iu.test(t)) return t;
  return `${t}\n\n${REGISTERED_OPEN_QUESTION_HELP_CLOSING}`;
}
