const HE_WEEKDAY =
  String.raw`(?:יום\s+)?(?:א['׳]|ב['׳]|ג['׳]|ד['׳]|ה['׳]|ו['׳]|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)`;

/**
 * עדכון שהלקוחה דחתה / החליפה שיעור / נרשמה לשעה הלא נכונה — לא «סיימתי להירשם לניסיון».
 * מופעל לפני matchesTrialAlreadyRegisteredMessage. אין לזואי סמכות לשנות הרשמה.
 */
export function matchesClassRescheduleUpdate(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  const n = t.toLowerCase();

  const hebrewPostpone =
    /דחית(?:י|נו)|נדחה\s+לי|העברתי\s+(?:את\s+)?ה?(?:שיעור|אימון)|עברתי\s+ל(?:שיעור|אימון|יום)|החלפת(?:י|נו)\s+(?:את\s+|ל)?ה?(?:שיעור|אימון|מועד|יום)|שיניתי\s+(?:את\s+)?ה?(?:שיעור|אימון|מועד)/u.test(
      t
    );
  const hebrewSignedForDay = new RegExp(
    String.raw`נרשמ(?:תי|נו)\s+ל${HE_WEEKDAY}`,
    "u"
  ).test(t);
  const wrongTimeOrMistake =
    /(?:נרשמ(?:תי|נו|ת)|רשומ(?:ה|ים|ות)|רשום(?:ה)?).{0,80}(?:בטעות|במקום)/u.test(t) ||
    /(?:בטעות|במקום).{0,80}(?:נרשמ(?:תי|נו|ת)|רשומ(?:ה|ים|ות)|רשום(?:ה)?)/u.test(t) ||
    /(?:שעה|מועד).{0,24}(?:לא\s+נכון|הלא\s+נכון|הלא\s+נכונה)/u.test(t);
  const english =
    /\b(i\s+)?(postponed|rescheduled|moved)\b.{0,40}\b(class|session|lesson|it)\b/i.test(n) ||
    /\bchanged\s+(my\s+)?(class|session|lesson|time|day)\b/i.test(n) ||
    /\bregistered\s+(at|for|to)\s+the\s+wrong\b/i.test(n) ||
    /\bsigned\s+up\s+(at|for|to)\s+the\s+wrong\b/i.test(n) ||
    /\bby\s+mistake\b.{0,40}\b(registered|signed\s+up|class|time)\b/i.test(n);

  return hebrewPostpone || hebrewSignedForDay || wrongTimeOrMistake || english;
}

export function buildClassRescheduleTeamHandoffReply(botName: string): string {
  const bot = String(botName ?? "").trim() || "זואי";
  return `היי! כאן ${bot}, אני אעביר את הפנייה שלך לצוות!`;
}

/** קלוד טען ששינה הרשמה — אין סמכות; מחליפים בהעברה לצוות. */
export function assistantReplyClaimsUnauthorizedBookingChange(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return (
    /עשיתי.{0,40}שינוי.{0,40}הרשמ/u.test(t) ||
    /שיניתי.{0,40}(?:את\s+)?ההרשמ/u.test(t) ||
    /עדכנתי.{0,40}(?:את\s+)?ההרשמ/u.test(t) ||
    /העברתי.{0,24}(?:אותך|אותכם|את\s+ההרשמ).{0,24}לשעה/u.test(t) ||
    /את(?:ה|ם)?\s+צריכ(?:ה|ים).{0,24}ברשומ/u.test(t)
  );
}
