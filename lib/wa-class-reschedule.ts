const HE_WEEKDAY =
  String.raw`(?:יום\s+)?(?:א['׳]|ב['׳]|ג['׳]|ד['׳]|ה['׳]|ו['׳]|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)`;

/**
 * Inbound skip-Claude optimization only — not the primary defense.
 * New customer phrasings will miss this on purpose; the outbound claim-guard
 * (`assistantReplyClaimsUnauthorizedBookingChange`) is what must catch fabricated confirmations.
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

/** Completed-change verbs only — not «רשמתי/קבעתי» (those fire on legitimate new signups). */
const FIRST_PERSON_DONE =
  String.raw`(?<![א-ת])(?:עשיתי|שיניתי|עדכנתי|תיקנתי|העברתי|שמתי|סידרתי)`;

/**
 * Primary defense: any generated reply that claims a completed booking change.
 * Independent of inbound intent classification. Must not rely on growing keyword lists
 * for customer phrasings — only on what Zoe claims she already did.
 */
export function assistantReplyClaimsUnauthorizedBookingChange(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  const n = t.toLowerCase();
  const movedYouToSlot = new RegExp(
    String.raw`${FIRST_PERSON_DONE}\s+(?:לך|לכם|אותך|אותכם).{0,48}(?:ל-?\s*\d|ב-?\s*\d|לשעה|למועד|לשיעור|לשיבוץ|ברביעי|בחמישי|בשלישי|בשני|בראשון|ביום|ההרשמ|השיבוץ|היומן|שינוי)`,
    "u"
  ).test(t);
  const touchedBookingObject = new RegExp(
    String.raw`${FIRST_PERSON_DONE}.{0,40}(?:את\s+)?(?:ההרשמ|המועד|השעה|השיבוץ|היומן)`,
    "u"
  ).test(t);
  const claimedUpdated =
    /הכל\s+מעודכן.{0,20}(?:ביומן|בהרשמ|בשיבוץ)/u.test(t) ||
    /ה(?:הרשמ|מועד|שיבוץ)\s+מעודכן/u.test(t) ||
    /מעודכן.{0,12}(?:ביומן|בהרשמ)/u.test(t);
  const englishClaim =
    /\bi\s+(moved|updated|changed|fixed|registered|booked)\s+you\b/i.test(n) ||
    /\byour\s+(booking|registration|class|slot|time)\s+(is\s+)?(now\s+)?(updated|changed|fixed|moved)\b/i.test(
      n
    ) ||
    /\bi\s+(made|did)\s+(the\s+)?(change|update)\b.{0,24}\b(booking|registration|class)\b/i.test(n);
  return (
    movedYouToSlot ||
    touchedBookingObject ||
    claimedUpdated ||
    /עשיתי.{0,40}שינוי.{0,40}הרשמ/u.test(t) ||
    /את(?:ה|ם)?\s+צריכ(?:ה|ים).{0,32}ברשומ/u.test(t) ||
    englishClaim
  );
}

export type UnauthorizedBookingHandoffReason = "assistant_claim" | "inbound_intent";

export type UnauthorizedBookingHandoffDecision = {
  handoff: boolean;
  reason: UnauthorizedBookingHandoffReason | null;
};

/**
 * Assistant claim is checked first (primary). Inbound keyword match is only a
 * skip-Claude optimization for known phrasings.
 */
export function resolveUnauthorizedBookingHandoff(opts: {
  inbound: string;
  assistantReply: string | null | undefined;
}): UnauthorizedBookingHandoffDecision {
  const reply = String(opts.assistantReply ?? "").trim();
  if (reply && assistantReplyClaimsUnauthorizedBookingChange(reply)) {
    return { handoff: true, reason: "assistant_claim" };
  }
  if (matchesClassRescheduleUpdate(opts.inbound)) {
    return { handoff: true, reason: "inbound_intent" };
  }
  return { handoff: false, reason: null };
}
