import {
  looksLikePersonalDoItRequest,
  matchClassCancelPlaybook,
  matchesIllnessCheckIn,
} from "@/lib/wa-closed-playbook-intents";
import {
  asksWhichClassesOnDay,
  looksLikeClassTimeQuestion,
  parseRequestedClassDays,
} from "@/lib/wa-unknown-class-slot";

/**
 * First-pass speech act — before timetable / Claude.
 * booking_mutation wins over illness-as-reason and over a leftover class in the thread.
 */
export type InboundSpeechAct = "booking_mutation" | "schedule_ask" | "illness_only" | "other";

function normalizeActText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

const BOOKING_OBJECT_RE = /שיעור|אימון|הרשמ|מועד|יומן|\bclass\b|\bsession\b|\blesson\b|\bbooking\b/iu;

export function isBookingMutationRequest(raw: string): boolean {
  const t = normalizeActText(raw);
  if (!t) return false;
  if (matchClassCancelPlaybook(t)?.shape === "action") return true;
  return looksLikePersonalDoItRequest(t) && BOOKING_OBJECT_RE.test(t);
}

export function isScheduleAsk(raw: string, now: Date = new Date()): boolean {
  const t = normalizeActText(raw);
  if (!t) return false;
  if (looksLikeClassTimeQuestion(t) || asksWhichClassesOnDay(t)) return true;
  if (parseRequestedClassDays(t, now).length === 0) return false;
  return /מתי|יש\s+(?:שיעור|אימון)|באיזו\s+שעה|באיזה\s+שעה|להגיע|להצטרף|לבוא|מועד|[?؟]/u.test(t);
}

export function classifyInboundSpeechAct(raw: string, now: Date = new Date()): InboundSpeechAct {
  const t = normalizeActText(raw);
  if (!t) return "other";
  if (isBookingMutationRequest(t)) return "booking_mutation";
  if (matchesIllnessCheckIn(t)) return "illness_only";
  if (isScheduleAsk(t, now)) return "schedule_ask";
  return "other";
}

const TIMETABLE_FRAGMENT_MAX = 28;

function isTimetableFragment(raw: string, now: Date): boolean {
  const t = normalizeActText(raw);
  if (!t || t.length > TIMETABLE_FRAGMENT_MAX) return false;
  if (isScheduleAsk(t, now)) return true;
  if (parseRequestedClassDays(t, now).length === 0) return true;
  const compact = t.replace(/[?؟!.\s]/g, "");
  return compact.length <= 8;
}

/** לוח שיעורים רק על שאלת לוח, או שבריר («כיסא» / «הערב») אחרי שאלה. */
export function shouldAnswerFromClassTimetable(raw: string, now: Date = new Date()): boolean {
  const t = normalizeActText(raw);
  if (!t) return false;
  const act = classifyInboundSpeechAct(t, now);
  if (act === "booking_mutation" || act === "illness_only") return false;
  if (act === "schedule_ask") return true;
  return isTimetableFragment(t, now);
}
