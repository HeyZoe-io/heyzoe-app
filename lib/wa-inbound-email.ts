/** הודעה שהיא כתובת מייל (ואולי תווית כמו «המייל שלי») — לא שאלה, לא לענות. */

function emailRegex(): RegExp {
  return /<?[a-z0-9](?:[a-z0-9._%+\-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)*\.[a-z]{2,}>?/gi;
}

/** מוריד כתובות מייל כדי שזיהוי שפה לא ייספר אותיות לטיניות מהכתובת. */
export function stripInboundEmailTokens(raw: string): string {
  return String(raw ?? "")
    .replace(/mailto:/gi, " ")
    .replace(emailRegex(), " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_LABEL =
  /^(?:e-?mail|mail|mailto|address|my|is|the|here|this|מייל|המייל|אימייל|האימייל|דואל|דואר|אלקטרוני|כתובת|שלי|הנה|זה|זאת)$/iu;

function stripEmailIntroPhrases(raw: string): string {
  return raw
    .replace(/אי[\-\u2010\u2011\u05be]?מייל/giu, " ")
    .replace(/דוא["״׳']?ל/giu, " ")
    .replace(/e[\-\s]?mail/gi, " ");
}

/**
 * כל ההודעה היא כתובת מייל, אולי עם תווית («המייל שלי», «email:»).
 * משפט או שאלה ליד הכתובת — לא.
 */
export function looksLikeEmailOnlyMessage(raw: unknown): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length > 800) return false;
  if (!emailRegex().test(t)) return false;
  const tokens = stripEmailIntroPhrases(stripInboundEmailTokens(t))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((tok) => tok.trim())
    .filter(Boolean)
    .filter((tok) => !EMAIL_LABEL.test(tok));
  return tokens.length === 0;
}
