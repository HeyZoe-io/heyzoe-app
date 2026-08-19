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
  const cancelRegistration =
    /לבטל.{0,32}את\s+ההרשמ/u.test(t) ||
    /תבטל(?:י|ו)?\s+(?:לי\s+)?את\s+ההרשמ/u.test(t) ||
    /בטל(?:י|ו)\s+(?:לי\s+)?את\s+ההרשמ/u.test(t) ||
    /\bcancel\s+(my\s+)?(registration|booking|class|spot|lesson)\b/i.test(n);
  const english =
    /\b(i\s+)?(postponed|rescheduled|moved)\b.{0,40}\b(class|session|lesson|it)\b/i.test(n) ||
    /\bchanged\s+(my\s+)?(class|session|lesson|time|day)\b/i.test(n) ||
    /\bregistered\s+(at|for|to)\s+the\s+wrong\b/i.test(n) ||
    /\bsigned\s+up\s+(at|for|to)\s+the\s+wrong\b/i.test(n) ||
    /\bby\s+mistake\b.{0,40}\b(registered|signed\s+up|class|time)\b/i.test(n);

  return hebrewPostpone || hebrewSignedForDay || wrongTimeOrMistake || cancelRegistration || english;
}

export function buildClassRescheduleTeamHandoffReply(botName: string): string {
  const bot = String(botName ?? "").trim() || "זואי";
  return `היי! כאן ${bot}, אני אעביר את הפנייה שלך לצוות!`;
}

/** Booking/registration/schedule state Zoe has no authority to mutate. */
const BOOKING_DOMAIN =
  /הרשמ|שיבוץ|מועד|שיעור|יומן|רשימ|רשומ|booking|registration|\bclass\b|\bsession\b|\blesson\b|\bslot\b/iu;

const BOOKING_NOUN = String.raw`(?:ה?הרשמ\S*|ה?שיבוץ|ה?מועד|ה?שעה|ה?שיעור|ה?יומן|ה?רשימ\S*)`;

const BENEFICIARY = /(?:לך|לכם|אותך|אותכם)/u;

const SLOT_TARGET = /ל-?\s*\d|ב-?\s*\d|לשעה|למועד|לשיעור|לשיבוץ|מהרשימ|מהשיעור|מהיומן/u;

/**
 * Speech / cognition / perception — not a mutation of their booking.
 * Polarity is a denylist of non-actions so new mutation verbs stay caught.
 */
const NON_MUTATING_HE_PAST = new Set([
  "הבנתי",
  "שמעתי",
  "ראיתי",
  "חשבתי",
  "התנצלתי",
  "שמחתי",
  "שאלתי",
  "עניתי",
  "כתבתי",
  "שלחתי",
  "הסברתי",
  "בדקתי",
  "מצאתי",
  "זכרתי",
  "שכחתי",
  "קיבלתי",
  "חיכיתי",
  "קראתי",
  "ידעתי",
  "הכרתי",
  "ציפיתי",
  "קיוויתי",
  "הודעתי",
  "הצטערתי",
  "התרגשתי",
  "הסכמתי",
  "הבטחתי",
  "ניסיתי",
  "הצלחתי",
  "נכשלתי",
  "הרגשתי",
  "נזכרתי",
  "התכוונתי",
  "החלטתי",
  "אמרתי",
  "דיברתי",
  "סיפרתי",
  "ציינתי",
  "הייתי",
  "יכולתי",
  "רציתי",
  "אהבתי",
  "פחדתי",
  "הסתכלתי",
  "חיפשתי",
]);

const NON_MUTATING_EN_PAST =
  /^(wanted|needed|asked|told|hoped|expected|noticed|checked|saw|heard|loved|liked|missed|called|emailed|messaged|reminded|thanked)$/i;

function hebrewMutatingPastClaimsBooking(text: string): boolean {
  const re = /(?<![א-ת])([א-ת]{2,14}תי)(?![א-ת])/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const verb = m[1]!;
    if (NON_MUTATING_HE_PAST.has(verb)) continue;
    const window = text.slice(m.index, m.index + verb.length + 88);
    const directObject = new RegExp(String.raw`את\s+${BOOKING_NOUN}`, "u").test(window);
    const onBookingObject = /(?:את\s+|ב)ה?(?:הרשמ|שיבוץ|מועד|יומן)/u.test(window);
    if (directObject || onBookingObject) return true;
    if (BENEFICIARY.test(window) && (BOOKING_DOMAIN.test(window) || SLOT_TARGET.test(window))) {
      return true;
    }
  }
  return false;
}

function claimedBookingStateChanged(text: string): boolean {
  return (
    /ה(?:הרשמ|מועד|שיבוץ|שעה).{0,20}(?:בוטל|עודכן|שונה|הוסר)/u.test(text) ||
    /הוסר(?:ת|תם|ה)?\s+מ(?:ה)?(?:שיעור|רשימ|יומן)/u.test(text) ||
    /הכל\s+מעודכן.{0,20}(?:ביומן|בהרשמ|בשיבוץ)/u.test(text) ||
    /ה(?:הרשמ|מועד|שיבוץ)\s+מעודכן/u.test(text) ||
    /מעודכן.{0,12}(?:ביומן|בהרשמ)/u.test(text) ||
    /את(?:ה|ם)?\s+צריכ(?:ה|ים).{0,32}ברשומ/u.test(text)
  );
}

function englishMutatingPastClaimsBooking(text: string): boolean {
  const n = text.toLowerCase();
  const re =
    /\bi\s+(?:have\s+|just\s+)?([a-z]+ed)\s+(you|your)\b(?:\s+\w+){0,8}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n))) {
    const verb = m[1] ?? "";
    if (NON_MUTATING_EN_PAST.test(verb)) continue;
    const window = n.slice(m.index, m.index + (m[0]?.length ?? 0) + 48);
    if (BOOKING_DOMAIN.test(window) || SLOT_TARGET.test(window)) return true;
    if (/\byour\s+(booking|registration|class|slot|time|lesson|session)\b/i.test(window)) {
      return true;
    }
  }
  return (
    /\byour\s+(booking|registration|class|slot|time)\s+(is\s+)?(now\s+)?(updated|changed|fixed|moved|cancelled|canceled|removed)\b/i.test(
      n
    ) ||
    /\bi\s+(made|did)\s+(the\s+)?(change|update|cancellation)\b.{0,24}\b(booking|registration|class)\b/i.test(
      n
    )
  );
}

/**
 * Primary defense: generated reply asserts that booking/registration/schedule
 * state was already changed on the lead's behalf. Detects the pattern
 * (first-person completed action + their booking), not an allowlist of verbs.
 */
export function assistantReplyClaimsUnauthorizedBookingChange(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return (
    hebrewMutatingPastClaimsBooking(t) ||
    claimedBookingStateChanged(t) ||
    englishMutatingPastClaimsBooking(t)
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
