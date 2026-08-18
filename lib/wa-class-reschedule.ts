const HE_WEEKDAY =
  String.raw`(?:יום\s+)?(?:א['׳]|ב['׳]|ג['׳]|ד['׳]|ה['׳]|ו['׳]|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)`;

/**
 * עדכון שהלקוחה דחתה / החליפה שיעור — לא «סיימתי להירשם לניסיון».
 * מופעל לפני matchesTrialAlreadyRegisteredMessage.
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
  const english =
    /\b(i\s+)?(postponed|rescheduled|moved)\b.{0,40}\b(class|session|lesson|it)\b/i.test(n) ||
    /\bchanged\s+(my\s+)?(class|session|lesson|time|day)\b/i.test(n);

  return hebrewPostpone || hebrewSignedForDay || english;
}

export function buildClassRescheduleTeamHandoffReply(botName: string): string {
  const bot = String(botName ?? "").trim() || "זואי";
  return `היי כאן ${bot} הבוטית, תודה על העדכון! אמסור את המידע לצוות שלנו`;
}
