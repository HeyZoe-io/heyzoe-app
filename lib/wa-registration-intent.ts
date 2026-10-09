import { CLASS_CHANGE_TRIAL_TEAM_MODEL } from "@/lib/wa-class-change-trial";
import { buildClassRescheduleTeamHandoffReply } from "@/lib/wa-class-reschedule";
import { isRegistrationFailedInquiry } from "@/lib/wa-registration-failed-intent";
import { parseModelUsed } from "@/lib/wa-reply-route";
import { lookupPlaybookFact } from "@/lib/wa-closed-playbook-facts";
import { buildClosedPlaybookDefaultReply } from "@/lib/wa-closed-playbook-copy";
import type { ClosedPlaybookKnowledge } from "@/lib/wa-closed-playbook-types";
import { mapMembershipLookupReply } from "@/lib/wa-membership-lookup";
import {
  isExistingTrialEnrollmentMention,
  matchesCantAttendScheduledClass,
  matchesTrialTopicIntent,
} from "@/lib/wa-trial-topic-intent";
/** שאלת הבהרה לכוונת הרשמה מעורפלת — לפני standalone-help / Claude. */
export const REGISTRATION_INTENT_CLARIFY_QUESTION =
  "היי! 👋 יש לך מנוי קיים אצלנו או שמדובר באימון ניסיון?";
export const REGISTRATION_INTENT_HAS_MEMBERSHIP_REPLY =
  "אם כך, אפשר להירשם ישירות באפליקציה! האם נדרשת עזרה עם הרישום?";
export const REGISTRATION_INTENT_NO_MEMBERSHIP_REPLY =
  "אין בעיה, אז בוא נבחר עבורך אימון מהרשימה";

export const REGISTRATION_INTENT_CLARIFY_MODEL = "registration_intent_clarify";
export const REGISTRATION_INTENT_HAS_MEMBER_MODEL = "registration_intent_has_membership";
/** גם סמן פתיחת פלואו מכירה (כמו greeting) — כדי ש-sendFlowContinuation לא יידלג. */
export const REGISTRATION_INTENT_NO_MEMBER_MODEL = "registration_intent_no_member";

function normalizeRegistrationIntentText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * כוונת הרשמה/הצטרפות מעורפלת — דטרמיניסטי, בלי Claude.
 * כולל את דוגמת Limitless: «רוצה להצטרף בשבת לפוואר אנד הייט».
 * כולל בקשה שזואי תרשום: «אשמח שתרשמי אותי לאימון כוח».
 */
export function matchesRegistrationIntentPhrase(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t || t.length > 400) return false;

  if (/(?:רוצה|רוצים|מעוניין|מעוניינת).{0,40}(?:להצטרף|להירשם|להרשם)/u.test(t)) return true;
  if (/(?:הייתי|היינו)\s+שמח(?:ה|ים)?\s+(?:מאוד\s+)?לה[יי]?רשם/u.test(t)) return true;
  if (/(?:אשמח|נשמח)\s+(?:מאוד\s+)?לה[יי]?רשם/u.test(t)) return true;
  if (/(?:אני\s+)?מנסה\s+להירשם(?:\s+לשיעור)?/u.test(t)) return true;
  if (/(?:אני\s+)?מנסים\s+להירשם(?:\s+לשיעור)?/u.test(t)) return true;
  // «תרשמי/תרשמו/תירשמי אותי» / «תרשום אותי» / «רשמי אותי»
  if (/ת[יי]?רשמ(?:י|ו)\s+אות(?:י|נו)/u.test(t)) return true;
  if (/תרשום\s+אות(?:י|נו)/u.test(t)) return true;
  if (/(?:^|[^\p{L}])רשמ(?:י|ו)\s+אות(?:י|נו)/u.test(t)) return true;
  if (/(?:אפשר|אשמח|נשמח|רוצה|תוכל(?:י|ו)?).{0,24}לרשום\s+אות(?:י|נו)/u.test(t)) return true;
  if (/(?:please\s+)?(?:register|sign)\s+me\s+up\b/i.test(t)) return true;
  if (/(?:can you|could you|please)\s+register\s+me\b/i.test(t)) return true;
  return false;
}

const EXISTING_BOOKING_CUE =
  /(?:אני|אנחנו)\s+(?:כבר\s+)?רשו[םמ]|נרשמ(?:תי|נו|ה|ת)|יש\s+לי\s+(?:שיעור|אימון)|רשומ(?:ה|ים|ות)\s+ל(?:שיעור|אימון)|היינו\s+אמורים\s+(?:לעשות|להגיע)|אמורים\s+(?:לעשות|להגיע)\s+(?:ל)?(?:אימון|שיעור)/u;

const MOVE_SLOT_CUE =
  /יום\s+אחר|מועד\s+אחר|שבוע\s+אחר|לתאם\s+(?:מחדש|ל(?:יום|מועד))|לקבוע\s+מחדש|לדחות|להעביר|להחליף|להזיז|לשנות\s+(?:את\s+)?(?:ה)?(?:מועד|שיעור|אימון)|another\s+day|reschedule|postpone/iu;

const EXPLICIT_CLASS_MOVE =
  /(?:להחליף|לדחות|להעביר|להזיז)\s+(?:את\s+)?ה?(?:שיעור|אימון|אות)|לשנות\s+(?:את\s+)?ה?מועד|ל(?:תאם|קבוע)\s+ל(?:יום|מועד)\s+אחר|(?:אשמח|נשמח|רוצה|אפשר)\s+להחליף\s+שיעור/u;

/** «תמחקו אותי מהשיעור» / «תעבירו אותי ליום שני» — פעולה על שיבוץ קיים, לא שאלה על הלוח. */
function matchesStaffImperativeClassChange(t: string): boolean {
  if (/תמחק(?:י|ו)?\s+אות(?:י|נו).{0,60}(?:שיעור|אימון|הרשמ|רשימ)/u.test(t)) return true;
  if (/תעביר(?:י|ו)?\s+אות(?:י|נו).{0,60}(?:ליום|לשיעור|לאימון|לשעה|למועד|ביום|בשעה|\d)/u.test(t)) {
    return true;
  }
  return false;
}

/** «הייתי אמורה להגיע היום ב-7:15 … ביטלתי … אשמח להגיע מחר» — לא שאלת לוח. */
const WAS_SUPPOSED_TO_ARRIVE =
  /הייתי\s+אמור(?:ה|ים|ות)?\s+להגיע|היינו\s+אמור(?:ים|ות)?\s+להגיע/u;

const ALREADY_CANCELLED_ARRIVAL = /ביטל(?:תי|נו|ה|ת)/u;

/**
 * Already booked + wants another slot (or explicit swap/postpone).
 * Not «תבטלי» (Zoe do-it → playbook) and not a fresh «לתאם שיעור ניסיון».
 */
export function matchesBookedClassMoveIntent(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t || t.length > 500) return false;
  if (/תבטל(?:י|ו)?/u.test(t) || /\bplease\s+cancel\b/i.test(t)) return false;
  if (EXPLICIT_CLASS_MOVE.test(t)) return true;
  if (matchesStaffImperativeClassChange(t)) return true;
  if (WAS_SUPPOSED_TO_ARRIVE.test(t) && ALREADY_CANCELLED_ARRIVAL.test(t)) return true;
  if (EXISTING_BOOKING_CUE.test(t) && MOVE_SLOT_CUE.test(t)) return true;
  if (isExistingTrialEnrollmentMention(raw) && MOVE_SLOT_CUE.test(t)) return true;
  if (matchesCantAttendScheduledClass(raw)) return true;
  return false;
}

/**
 * כבר ניסו באפליקציה ולא הצליחו — לא לשלוח שוב «נכנסים ומבטלים», מעבירים לצוות.
 */
export function inboundSaysClassChangeAppFailed(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t) return false;
  if (/אי\s*אפשר.{0,32}אפליקצ/u.test(t)) return true;
  if (/לא\s+(?:נותנ|עובד|מצליח|הצלח).{0,40}אפליקצ/u.test(t)) return true;
  if (/אפליקצ.{0,40}(?:לא\s+נותנ|לא\s+עובד|לא\s+מצליח|תקוע)/u.test(t)) return true;
  if (/\b(?:can(?:not|'t)|unable|does(?:n't| not) work).{0,32}\bapp\b/i.test(t)) return true;
  return false;
}

export const BOOKED_CLASS_MOVE_APP_REPLY =
  "אפשר להחליף שיעור ישירות מהאפליקציה: נכנסים, מבטלים את ההרשמה ונרשמים למועד אחר. אם יש בעיה או שצריך עזרה — אני כאן!";
export const BOOKED_CLASS_MOVE_APP_MODEL = "booked_class_move_app";

export function buildBookedClassMoveAppReply(raw: string): string {
  const t = normalizeRegistrationIntentText(raw);
  const illness =
    /לא\s+מרגיש(?:ה|ים)?\s+טוב/u.test(t) ||
    /לא\s+בטוב/u.test(t) ||
    /(?:^|\s)חולה(?:\s|$|[.,!?])/u.test(t);
  return illness ? `מצטערת לשמוע! 💜 ${BOOKED_CLASS_MOVE_APP_REPLY}` : BOOKED_CLASS_MOVE_APP_REPLY;
}

/** שאלה לפני הזזת אימון בארבוקס — אותה נוסח כמו הבהרת הרשמה, מודל נפרד כדי שהתשובה לא תפתח פלואו. */
export const CLASS_MOVE_CLARIFY_MODEL = "class_move_clarify";
export const CLASS_MOVE_TRIAL_HANDOFF_MODEL = "class_move_trial_team_handoff";
export const RESCHEDULE_MEMBER_BY_FLAG_MODEL = "reschedule_member_by_flag";

export const RESCHEDULE_UNKNOWN_TEAM_REPLY =
  "אין לי את היכולת לעשות את זה אבל אני מעבירה לצוות שידאגו לך סבבה?";
export const RESCHEDULE_UNKNOWN_TEAM_MODEL = "reschedule_unknown_team_handoff";

export type ClassChangeSend = { reply: string; model: string; notifyTeam: boolean };

function trialClassChangeHandoff(): ClassChangeSend {
  return {
    reply: RESCHEDULE_UNKNOWN_TEAM_REPLY,
    model: CLASS_CHANGE_TRIAL_TEAM_MODEL,
    notifyTeam: true,
  };
}

/**
 * Class cancel after Claude confirmed the route.
 * A trial signal replaces the knowledge fact and the app how-to.
 * Member and unknown keep today's playbook reply, so an unsynced member still gets the policy.
 */
export function resolveClassCancelWithTrialGate(input: {
  claudeSaysTrial: boolean;
  storedFutureTrial: boolean;
  current: ClassChangeSend;
}): ClassChangeSend {
  if (input.claudeSaysTrial || input.storedFutureTrial) return trialClassChangeHandoff();
  return input.current;
}

/**
 * Reschedule playbook confirmed by booking_change, not the class_move route block.
 * Trial, then a known member's fact, then the same unknown handoff as rule A.
 */
export function resolveRescheduleHintWithTrialGate(input: {
  claudeSaysTrial: boolean;
  storedFutureTrial: boolean;
  arboxIsMember?: boolean | null;
  memberReply: ClassChangeSend;
}): ClassChangeSend {
  if (input.claudeSaysTrial || input.storedFutureTrial) return trialClassChangeHandoff();
  if (input.arboxIsMember === true) return input.memberReply;
  return {
    reply: RESCHEDULE_UNKNOWN_TEAM_REPLY,
    model: RESCHEDULE_UNKNOWN_TEAM_MODEL,
    notifyTeam: true,
  };
}
/** Fact sent by the booking_change fallback. Never a *_handoff tag. */
export const BOOKING_CHANGE_FACT_MODEL = "closed_playbook_fact_reschedule";

/**
 * booking_change after Claude, when no playbook hint already consumed the turn.
 * Trial first. A known member, or a class-cancel hint, keeps the knowledge fact.
 * Anyone else gets the rule A unknown handoff. A fact is never tagged as a handoff.
 */
export function resolveBookingChangeSend(input: {
  knowledge?: ClosedPlaybookKnowledge | null;
  claudeSaysTrial?: boolean;
  storedFutureTrial?: boolean;
  arboxIsMember?: boolean | null;
  /** Hint category class_cancel. Not a scan of the message. */
  hintSaysClassCancel?: boolean;
}): ClassChangeSend {
  if (input.claudeSaysTrial || input.storedFutureTrial) return trialClassChangeHandoff();
  const fact = lookupPlaybookFact("reschedule", input.knowledge)?.trim() ?? "";
  const keepFact = input.arboxIsMember === true || input.hintSaysClassCancel === true;
  if (keepFact && fact) {
    return { reply: fact, model: BOOKING_CHANGE_FACT_MODEL, notifyTeam: true };
  }
  if (keepFact) {
    return {
      reply: buildClosedPlaybookDefaultReply("reschedule", input.knowledge?.botName),
      model: "class_reschedule_team_handoff",
      notifyTeam: true,
    };
  }
  return {
    reply: RESCHEDULE_UNKNOWN_TEAM_REPLY,
    model: RESCHEDULE_UNKNOWN_TEAM_MODEL,
    notifyTeam: true,
  };
}

export type KnownMemberQuestionContext =
  | "registration_problem"
  | "registration_intent"
  | "reschedule";

/**
 * A known member never hears the member-or-trial question.
 * false and null stay on today's question. No Arbox call: the daily flag is already loaded.
 */
export function knownMemberInsteadOfMembershipQuestion(input: {
  arboxIsMember?: boolean | null;
  context: KnownMemberQuestionContext;
  knowledge?: ClosedPlaybookKnowledge | null;
  inbound?: string;
}): ClassChangeSend | null {
  if (input.arboxIsMember !== true) return null;
  if (input.context === "registration_problem") {
    const active = mapMembershipLookupReply("active");
    return { reply: active.text, model: active.modelUsed, notifyTeam: active.notifyHumanRequested };
  }
  if (input.context === "registration_intent") {
    const member = registrationIntentMemberFlagReply(true);
    return member ? { reply: member.reply, model: member.model, notifyTeam: false } : null;
  }
  const reschedule = resolveRescheduleWithMemberFlag(input.inbound ?? "", {
    knowledge: input.knowledge,
    arboxIsMember: true,
    hasArboxConnection: true,
  });
  return { reply: reschedule.reply, model: reschedule.model, notifyTeam: reschedule.notifyTeam };
}

export const REGISTRATION_INTENT_MEMBER_BY_FLAG_MODEL = "registration_intent_member_by_flag";
export const REGISTRATION_INTENT_MEMBER_HELP_HANDOFF_MODEL = "registration_intent_member_help_handoff";

/** Known member skips «האם יש מנוי קיים?» and gets the existing app-registration copy. */
export function registrationIntentMemberFlagReply(
  arboxIsMember: boolean | null | undefined
): { reply: string; model: string } | null {
  if (arboxIsMember !== true) return null;
  return {
    reply: REGISTRATION_INTENT_HAS_MEMBERSHIP_REPLY,
    model: REGISTRATION_INTENT_MEMBER_BY_FLAG_MODEL,
  };
}

export type ArboxClassMoveOutcome = {
  kind: "ask" | "member" | "trial_team" | "team_handoff";
  reply: string;
  model: string;
  notifyTeam: boolean;
};

function arboxClassMoveMemberReply(
  raw: string,
  knowledge: ClosedPlaybookKnowledge | null | undefined
): Pick<ArboxClassMoveOutcome, "reply" | "model"> {
  const fact = lookupPlaybookFact("reschedule", knowledge)?.trim() ?? "";
  if (fact) return { reply: fact, model: "closed_playbook_fact_reschedule" };
  return { reply: buildBookedClassMoveAppReply(raw), model: BOOKED_CLASS_MOVE_APP_MODEL };
}

/**
 * Arbox class move. The branch is Claude's route tag only — not words in the message.
 * class_move asks. class_move_member sends the app steps, or a knowledge fact when one exists.
 * class_move_trial hands off to the team.
 */
export function resolveArboxClassMoveOutcome(
  raw: string,
  opts?: {
    knowledge?: ClosedPlaybookKnowledge | null;
    stated?: "member" | "trial" | null;
  }
): ArboxClassMoveOutcome {
  const knowledge = opts?.knowledge ?? null;
  if (opts?.stated === "trial") {
    return {
      kind: "trial_team",
      reply: buildClassRescheduleTeamHandoffReply(knowledge?.botName ?? ""),
      model: CLASS_MOVE_TRIAL_HANDOFF_MODEL,
      notifyTeam: true,
    };
  }
  if (opts?.stated === "member") {
    const member = arboxClassMoveMemberReply(raw, knowledge);
    return { kind: "member", reply: member.reply, model: member.model, notifyTeam: false };
  }
  return {
    kind: "ask",
    reply: REGISTRATION_INTENT_CLARIFY_QUESTION,
    model: CLASS_MOVE_CLARIFY_MODEL,
    notifyTeam: false,
  };
}

/**
 * Reschedule no longer asks member-vs-trial.
 * A known Arbox member gets the existing member reply. Anyone else, including a
 * non-Arbox business, gets the team handoff. The handoff fires now; «סבבה?» is not a confirm step.
 */
export function resolveRescheduleWithMemberFlag(
  raw: string,
  opts?: {
    knowledge?: ClosedPlaybookKnowledge | null;
    arboxIsMember?: boolean | null;
    /** false = non-Arbox. Omitted means the caller already applied that. */
    hasArboxConnection?: boolean;
    /** Claude route class_move_trial or booking_change_trial. */
    claudeSaysTrial?: boolean;
    /** arbox_trial_booking_identity classification trial with a future start. */
    storedFutureTrial?: boolean;
  }
): ArboxClassMoveOutcome {
  if (opts?.claudeSaysTrial || opts?.storedFutureTrial) {
    const trial = trialClassChangeHandoff();
    return { kind: "trial_team", reply: trial.reply, model: trial.model, notifyTeam: true };
  }
  const knownMember = opts?.arboxIsMember === true && opts?.hasArboxConnection !== false;
  if (knownMember) {
    const member = arboxClassMoveMemberReply(raw, opts?.knowledge);
    return {
      kind: "member",
      reply: member.reply,
      model: RESCHEDULE_MEMBER_BY_FLAG_MODEL,
      notifyTeam: false,
    };
  }
  return {
    kind: "team_handoff",
    reply: RESCHEDULE_UNKNOWN_TEAM_REPLY,
    model: RESCHEDULE_UNKNOWN_TEAM_MODEL,
    notifyTeam: true,
  };
}

/**
 * The message after registration_intent_member_by_flag.
 * Help, a failed attempt, or yes → team handoff. Only used when that model was the last reply.
 */
export function registrationMemberFlagFollowupNeedsHandoff(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t) return false;
  if (classifyRegistrationIntentMembershipReply(raw) === "yes") return true;
  if (/עזרה/u.test(t)) return true;
  if (/לא\s+הצליח/u.test(t)) return true;
  if (isRegistrationFailedInquiry(raw)) return true;
  return false;
}

function inboundMentionsExistingPurchase(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t) return false;
  if (isExistingTrialEnrollmentMention(raw)) return true;
  if (EXISTING_BOOKING_CUE.test(t)) return true;
  if (matchesExistingMembershipClaim(raw)) return true;
  if (/כרטיסי[יה]|punch\s*card/iu.test(t)) return true;
  return false;
}

export type BookedClassMoveBranch = "app" | "product_pick";

/**
 * Swap of a purchased/booked class (membership, punch card, or trial) → app.
 * Sales flow with no purchase yet → pick another class. Unknown → app.
 */
export function resolveBookedClassMoveBranch(
  raw: string,
  opts?: {
    trialRegistered?: boolean;
    sessionPhase?: string | null;
    salesFlowStarted?: boolean;
  }
): BookedClassMoveBranch | null {
  if (!matchesBookedClassMoveIntent(raw)) return null;
  const phase = String(opts?.sessionPhase ?? "").trim();
  const purchased =
    opts?.trialRegistered === true ||
    phase === "registered" ||
    inboundMentionsExistingPurchase(raw);
  if (purchased) return "app";
  if (opts?.salesFlowStarted === true && phase !== "registered" && opts?.trialRegistered !== true) {
    return "product_pick";
  }
  return "app";
}

/**
 * הרשמה מעורפלת בלי «ניסיון» — לשאול מנוי מול ניסיון לפני פלואו מכירה.
 * «אשמח להירשם לשיעור ניסיון» נשאר בפלואו ניסיון.
 */
export function shouldAskMembershipVsTrialFirst(raw: string): boolean {
  return matchesRegistrationIntentPhrase(raw) && !matchesTrialTopicIntent(raw);
}

export const EXISTING_MEMBERSHIP_HELP_REPLY = "מעולה! איך אפשר לעזור לך?";
export const EXISTING_MEMBERSHIP_HELP_MODEL = "existing_membership_help";

/**
 * הצהרת מנוי קיים בפלואו מכירה — לא תשובת כן/לא לשאלת הבהרה, ולא «רוצה מנוי».
 */
export function matchesExistingMembershipClaim(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t || t.length > 400) return false;
  if (/אין(?:\s+לי|\s+לנו)?\s+מנוי/u.test(t)) return false;
  if (/(?:רוצה|רוצים|מעוניין|מעוניינת).{0,24}מנוי/u.test(t)) return false;
  if (/^(?:מה|איך|כמה|מתי|איפה|האם|למה)\b.{0,40}מנוי/u.test(t)) return false;

  if (/יש(?:\s+לי|\s+לנו)\s+מנוי/u.test(t)) return true;
  if (/(?:אני|אנחנו)\s+(?:כבר\s+)?מנו[יהםות]{1,3}(?:\s|$|[.,!?])/u.test(t)) return true;
  if (/\bi(?:'m|\s+am)\s+(?:already\s+)?a\s+member\b/i.test(t)) return true;
  if (/\bi\s+(?:already\s+)?have\s+a\s+membership\b/i.test(t)) return true;
  return false;
}

export type RegistrationIntentMembershipReply = "yes" | "no" | "unclear";

/** תשובת כן/לא לשאלת מנוי קיים מול אימון ניסיון — לא לולאה על מעורפל. */
export function classifyRegistrationIntentMembershipReply(raw: string): RegistrationIntentMembershipReply {
  const t = normalizeRegistrationIntentText(raw);
  if (!t) return "unclear";

  if (/אין(?:\s+לי|\s+לנו)?\s+מנוי/u.test(t)) return "no";
  if (/מדובר באימון ניסיון|(?:^|\s)אימון ניסיון(?:\s|$|[.,!?])/u.test(t) && !/מנוי/u.test(t)) {
    return "no";
  }
  if (/^(?:אימון\s+)?ניסיון(?:\s|$|[.,!?])/iu.test(t)) return "no";
  if (/מנוי קיים|יש(?:\s+לי|\s+לנו)?\s+מנוי/u.test(t)) return "yes";
  if (/^מנוי(?:\s|$|[.,!?])/u.test(t)) return "yes";

  if (/^(לא|אין לי|אין לנו|no|nope)(?:\b|[.!,?\s]|$)/iu.test(t)) return "no";
  if (/^(כן|יש לי|יש לנו|בטח|yes|yep|yeah)(?:\b|[.!,?\s]|$)/iu.test(t)) return "yes";

  return "unclear";
}

export type MembershipQuestionAnswerContext = "registration_intent" | "other";

/**
 * The clarify question is stored as registration_intent_clarify with a route suffix.
 * registration_clarify is the registration-intent question. Any other suffix keeps
 * that path's own answer handling.
 */
export function membershipQuestionAnswerContext(
  modelUsed: string | null | undefined
): MembershipQuestionAnswerContext | null {
  const parsed = parseModelUsed(modelUsed);
  if (parsed.model !== REGISTRATION_INTENT_CLARIFY_MODEL) return null;
  if (parsed.hint === "registration_clarify" || !parsed.route) return "registration_intent";
  if (parsed.route === "member_or_trial_unclear") return "other";
  if (parsed.hint && parsed.hint !== "registration_clarify") return "other";
  return "registration_intent";
}

/** Registration-intent answers. Bare «קיים» is the short yes to «מנוי קיים». */
export function registrationIntentMembershipAnswer(raw: string): RegistrationIntentMembershipReply {
  const classified = classifyRegistrationIntentMembershipReply(raw);
  if (classified !== "unclear") return classified;
  const t = normalizeRegistrationIntentText(raw);
  if (/^קיים(?:\s|$|[.,!?])/u.test(t)) return "yes";
  return "unclear";
}

export function registrationMemberCopyAwaitingHelp(modelUsed: string | null | undefined): boolean {
  const base = parseModelUsed(modelUsed).model;
  return (
    base === REGISTRATION_INTENT_MEMBER_BY_FLAG_MODEL ||
    base === REGISTRATION_INTENT_HAS_MEMBER_MODEL
  );
}

/** Reschedule tags only when this inbound is a real move, not an answer to the membership question. */
export function rescheduleTagApplies(lastModel: string | null | undefined, inbound: string): boolean {
  const base = parseModelUsed(lastModel).model;
  const answeringQuestion =
    base === REGISTRATION_INTENT_CLARIFY_MODEL ||
    base === "booking_lookup_clarify" ||
    base === CLASS_MOVE_CLARIFY_MODEL;
  if (answeringQuestion && !matchesBookedClassMoveIntent(inbound)) return false;
  return true;
}
