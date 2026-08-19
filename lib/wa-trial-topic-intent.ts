import {
  normalizeSalesFlowGreetingToken,
  stripLeadingCasualGreeting,
} from "@/lib/sales-flow-start-triggers";

function normalizeTrialTopicText(raw: string): string {
  return normalizeSalesFlowGreetingToken(raw);
}

/** Common Hebrew typo: הכרות (without י) vs היכרות */
const TRIAL_TOPIC_MARKERS =
  /(?:ניסיון|נסיון|היכרות|הכרות|\btrial\b|\bintro\b|taster|first\s+class)/iu;

const TRIAL_CLASS_PHRASE =
  /(?:אימון|שיעור|אימוני|שיעורי|class).{0,16}(?:ניסיון|נסיון|היכרות|הכרות)/u;

/** Lead asks about or wants trial / intro training — incl. «אימון הכרות» typo. */
export function matchesTrialTopicIntent(raw: string): boolean {
  const normalized = normalizeTrialTopicText(raw);
  const t = stripLeadingCasualGreeting(normalized);
  if (!t || t.length > 400) return false;
  if (!TRIAL_TOPIC_MARKERS.test(t)) return false;
  if (TRIAL_CLASS_PHRASE.test(t)) return true;
  if (/אימוני\s+(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)) return true;
  if (/שיעור(?:י)?\s+(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)) return true;
  if (/(?:ניסיון|נסיון|היכרות|הכרות).{0,20}(?:אימון|שיעור)/u.test(t)) return true;
  if (/(?:מה|איך|כמה|יש|אפשר|ספר(?:י|ו)?|מידע|פרטים).{0,48}(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)) {
    return true;
  }
  if (/(?:רוצ(?:ה|ים|ה)|מעוניין|מעוניינת|אשמח|נשמח).{0,32}(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)) {
    return true;
  }
  return false;
}

/** Wants to start trial flow — skip warmup / open product pick (not pure price FAQ). */
export function matchesTrialTopicAdvanceIntent(raw: string): boolean {
  const normalized = normalizeTrialTopicText(raw);
  const t = stripLeadingCasualGreeting(normalized);
  if (!t || !matchesTrialTopicIntent(t)) return false;
  if (/^(?:כמה|מה\s+המחיר|מה\s+עולה|עולה|מחיר)/u.test(t) && !/(?:רוצ|אשמח|נשמח|להירשם|להצטרף|לנסות)/u.test(t)) {
    return false;
  }
  if (
    /(?:רוצ(?:ה|ים|ה)|מעוניין|מעוניינת|אשמח|נשמח|אפשר|בוא(?:י|ו)?\s+נ).{0,40}(?:ניסיון|נסיון|היכרות|הכרות|להירשם|להצטרף|לנסות)/u.test(
      t
    )
  ) {
    return true;
  }
  if (/^(?:רוצ(?:ה|ים|ה)|אשמח|נשמח)\s+(?:אימון|שיעור)/u.test(t)) return true;
  if (/^(?:איך|איפה)\s+(?:נרשמ|מצטרפ|קונים|רוכשים)/u.test(t)) return true;
  if (/^(?:איך|מה)\s+(?:זה|עובד|כולל)/u.test(t) && TRIAL_TOPIC_MARKERS.test(t)) return true;
  if (/^(?:יש|אפשר)\s+(?:אימון|שיעור)/u.test(t)) return true;
  return false;
}

export const TRIAL_TOPIC_FLOW_ENTRY_MODEL = "trial_topic_flow_entry";
export const TRIAL_TOPIC_QA_REPLY_MODEL = "trial_topic_qa_reply";
