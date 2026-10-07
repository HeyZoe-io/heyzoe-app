/**
 * זואי לא מפנה ולא ממליצה על סטודיו אחר.
 * אם אין לה תשובה — העברה לצוות, לא שם של מקום חלופי.
 */

function normalize(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/** הכחשה («אין לנו סטודיו אחר») — לא המלצה. */
function deniesAnotherPlace(text: string): boolean {
  return /(?:אין|לא)(?:\s+\S+){0,6}\s+(?:סטודיו|מכון|חדר\s*כושר|מקום)\s+אחר/u.test(text);
}

/** תשובה שמפנה או ממליצה על סטודיו / מכון / מקום אחר. */
export function assistantReplyRecommendsAnotherStudio(raw: string, businessName = ""): boolean {
  const own = String(businessName ?? "").trim();
  let t = normalize(raw);
  if (!t) return false;
  if (own.length >= 2) t = t.split(own).join(" ");

  const anotherPlace = /(?:סטודיו|מכון|חדר\s*כושר)\s+אחר/u.test(t);
  if (anotherPlace && !deniesAnotherPlace(t)) return true;

  if (
    /ממליצ(?:ה|ים|ות)?(?:\s+\S+){0,5}\s+על\s+(?!ה)(?:סטודיו|מכון|חדר\s*כושר)/u.test(t)
  ) {
    return true;
  }

  if (
    /יש\s+(?:עוד\s+)?(?:סטודיו|מכון|חדר\s*כושר)(?:\s+\S+){0,4}\s+(?:בשם|שנקרא|שקוראים)/u.test(t)
  ) {
    return true;
  }

  const enAnother = /\b(?:another|a different|other)\s+(?:studio|gym)\b/i.test(t);
  const enDenial =
    /\b(?:no|not|don't|do not|we don't have|we do not have)\b[^.]{0,48}\b(?:another|other|different)\s+(?:studio|gym)\b/i.test(
      t
    );
  if (enAnother && !enDenial) return true;

  if (
    /\b(?:recommend|suggest)\w*\b[^.]{0,60}\b(?:studio|gym)\b/i.test(t) &&
    !/\b(?:our|this)\s+(?:studio|gym)\b/i.test(t)
  ) {
    return true;
  }

  return false;
}
