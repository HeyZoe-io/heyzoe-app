/** הודעת ליד שהיא לינק בלבד — לא שאלה, לא לענות. */

function urlTokenRegexes(): RegExp[] {
  return [
    /(?:https?:\/\/|www\.)[^\s<>"']+/gi,
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|co\.il|org|net|io|app|link|me|ly|gl|dev|info|biz|tv|cc|be)(?:\/[^\s<>"']*)?/gi,
  ];
}

/** מוריד טוקני URL כדי שזיהוי שפה לא ייספר אותיות לטיניות מהלינק. */
export function stripInboundUrlTokens(raw: string): string {
  let t = String(raw ?? "");
  for (const re of urlTokenRegexes()) {
    t = t.replace(re, " ");
  }
  return t.replace(/\s+/g, " ").trim();
}

function leftoverAfterUrls(raw: string): string {
  return stripInboundUrlTokens(raw)
    .replace(/[\s\u200b\u200c\u200d\ufeff.,;:!?؟،\-–—_/\\|~*'"`()[\]{}<>]+/g, "")
    .trim();
}

/**
 * כל ההודעה היא קישור (http/https/www או דומיין.tld), בלי טקסט ממשי מסביב.
 * כותרת OG / שאלה ליד הלינק — לא.
 */
export function looksLikeLinkOnlyMessage(raw: unknown): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length > 2000) return false;
  const stripped = stripInboundUrlTokens(t);
  if (stripped === t.replace(/\s+/g, " ").trim()) return false;
  return leftoverAfterUrls(t).length === 0;
}
