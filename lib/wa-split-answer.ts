/**
 * ניקוי תשובת AI כשהמערכת שולחת CTA / המשך פלואו / תפריט כפתורים בהודעה נפרדת.
 */

import { CTA_SERVICE_REPICK_BRIDGE_QUESTION } from "@/lib/wa-cta-service-repick";

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
  if (t.includes(CTA_SERVICE_REPICK_BRIDGE_QUESTION)) return false;
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

function normalizeCtaHookLine(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isSalesFlowCtaHookLine(line: string): boolean {
  const n = normalizeCtaHookLine(line);
  if (!n) return false;
  if (n.startsWith("מה דעתך? שנשריין אימון ניסיון")) return true;
  if (/מה דעתך.*אימון.*ניסיון/u.test(n)) return true;
  if (/עכשיו רק נותר לשריין/u.test(n)) return true;
  if (/^לשמור לך מקום/u.test(n) || /^לשמור לכם מקום/u.test(n)) return true;
  if (/תשלום מאובטח/u.test(n) && /הטבה דרך השיחה/u.test(n)) return true;
  return false;
}

/**
 * CTA-phase split only: drop leaked booking-prompt closings from the free-text answer
 * before the real interactive CTA is sent separately.
 */
export function stripSalesFlowCtaHookFromAnswer(text: string): string {
  let raw = String(text ?? "").replace(/\r\n/g, "\n");
  raw = raw.replace(/([?!.…🙂💜)])\s+(עכשיו רק נותר לשריין)/gu, "$1\n$2");
  raw = raw.replace(/([?!.…🙂💜)])\s+(לשמור לך מקום|לשמור לכם מקום)/gu, "$1\n$2");
  const filtered = raw.split("\n").filter((l) => !isSalesFlowCtaHookLine(l));
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const REGISTERED_OPEN_QUESTION_HELP_CLOSING =
  "יש עוד משהו שאני יכולה לעזור לך בו?";

export const STANDALONE_OPEN_QUESTION_HELP_CLOSING =
  "יש עוד משהו שאני יכולה לעזור לך איתו?";

function ensureHelpClosing(text: string, closing: string): string {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return closing;
  if (/יש עוד משהו.*(עזור|לעזור)/iu.test(t)) return t;
  return `${t}\n\n${closing}`;
}

/** האם הליד שאל שאלה — לא עובדה/עדכון. שאלת הסגירה «יש עוד משהו» רק אז. */
export function looksLikeLeadQuestion(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  if (/[?؟]/.test(t)) return true;
  const first = t.split(/[\n.!…]/)[0]?.trim() ?? t;
  if (
    /^(מה|איך|האם|מי|איפה|מתי|למה|מדוע|כמה|אפשר|תוכלו|תוכל|היכן)(?:\s|$)/u.test(first)
  ) {
    return true;
  }
  if (
    /^(what|how|when|where|why|who|can\s+i|do\s+you|is\s+there|are\s+there|could\s+you)\b/i.test(
      first
    )
  ) {
    return true;
  }
  return false;
}

/** אחרי «נרשמתי» — מוסיף שאלת סיום אם חסרה */
export function ensureRegisteredOpenQuestionClosing(text: string): string {
  return ensureHelpClosing(text, REGISTERED_OPEN_QUESTION_HELP_CLOSING);
}

/** שאלה רגילה מחוץ לפלואו מכירה — סיום ב«יש עוד משהו…» בלי תפריט אימונים */
export function ensureStandaloneOpenQuestionClosing(text: string): string {
  return ensureHelpClosing(text, STANDALONE_OPEN_QUESTION_HELP_CLOSING);
}

/** שאלה פתוחה מחוץ לפלואו — גם אם session_phase נשאר warmup/cta מפתיחה שגויה. */
export function isStandaloneWhatsAppOpenQuestion(input: {
  sessionPhase: string;
  salesFlowStarted: boolean;
  registered: boolean;
}): boolean {
  if (input.registered) return false;
  return !input.salesFlowStarted;
}
