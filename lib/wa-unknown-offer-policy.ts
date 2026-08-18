/** חריג לחבילת היכרות שאין עליו עובדה — לא מנחשים כן/לא. */
export const UNKNOWN_OFFER_POLICY_HANDOFF_REPLY =
  "אני לא בטוחה לגבי זה, אני מעבירה את הבקשה לצוות";

export const UNKNOWN_OFFER_POLICY_HANDOFF_MODEL = "unknown_offer_policy_team_handoff";

function normalizePolicyBlob(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/** «אפשר אחד?» / רק שיעור בודד במקום חבילת שני אימוני היכרות. */
export function isIntroPackSplitQuestion(text: string): boolean {
  const t = normalizePolicyBlob(text);
  if (!t || t.length > 400) return false;
  if (/(?:אפשר|ניתן|אפשרי).{0,28}(?:רק\s+)?(?:אחד|אחת|בודד)/u.test(t)) return true;
  if (/(?:רק|רק\s+את\s+)?(?:שיעור|אימון)\s+אחד/u.test(t)) return true;
  if (/לקנות\s+אחד|לרכוש\s+אחד|בלי\s+(?:את\s+)?השני/u.test(t)) return true;
  if (/לפצל.{0,20}(?:חבילה|היכרות|ניסיון)/u.test(t)) return true;
  return false;
}

/** יש בעובדות/FAQ תשובה מפורשת לחריג (כן או לא) — לא מספיק מחיר «לשני אימוני היכרות». */
export function knowledgeCoversIntroPackSplit(blobs: string[]): boolean {
  const blob = blobs.map((s) => normalizePolicyBlob(s)).filter(Boolean).join("\n");
  if (!blob) return false;
  return (
    /(?:שיעור|אימון).{0,24}(?:אחד|בודד)/u.test(blob) ||
    /בודד.{0,16}(?:שיעור|אימון)/u.test(blob) ||
    /אפשר.{0,40}(?:אחד|בודד)/u.test(blob) ||
    /רק\s+אחד/u.test(blob) ||
    /לא\s+ניתן.{0,40}(?:אחד|בודד)/u.test(blob) ||
    /לא\s+מפצל(?:ים)?/u.test(blob) ||
    /חובה.{0,24}שני/u.test(blob) ||
    /חייבים.{0,24}שני/u.test(blob)
  );
}

export function shouldHandoffUnknownIntroPackSplit(input: {
  text: string;
  knowledgeBlobs: string[];
}): boolean {
  if (!isIntroPackSplitQuestion(input.text)) return false;
  return !knowledgeCoversIntroPackSplit(input.knowledgeBlobs);
}
