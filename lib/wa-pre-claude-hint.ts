import { isWholeMessageHumanRequest } from "@/lib/wa-send-before-claude";
import { isScheduleInquiryIntent } from "@/lib/wa-booking-lookup";
import { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook-intents";
import { isDemotedClosedPlaybook, type FastPathHint } from "@/lib/wa-fast-path-hint";
import { classifyInboundSpeechAct } from "@/lib/wa-inbound-speech-act";
import { isRegistrationFailedInquiry } from "@/lib/wa-registration-failed-intent";
import { matchesBookedClassMoveIntent } from "@/lib/wa-registration-intent";
import { matchesArboxRegistrationVerifyAsk } from "@/lib/wa-arbox-registration-verify";
import { isScheduleIntent } from "@/lib/wa-schedule-intent";
import { isJoinSignupIntentText } from "@/lib/wa-warmup-skip-intent";

/**
 * Keyword guess for the one Claude call. Does not send and does not call Arbox.
 * Claude's route decides the closed copy.
 */
export function collectPreClaudeHint(text: string): FastPathHint | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (matchesArboxRegistrationVerifyAsk(raw)) {
    return { matcher: "registration_verify", category: "registration_verify" };
  }
  const playbook = detectClosedPlaybookIntent(raw);
  if (playbook && isDemotedClosedPlaybook(playbook.category)) {
    return { matcher: "closed_playbook", category: playbook.category };
  }
  if (classifyInboundSpeechAct(raw) === "booking_mutation") {
    return { matcher: "booking_mutation", category: "booking_mutation" };
  }
  if (matchesBookedClassMoveIntent(raw)) {
    return { matcher: "booked_class_move", category: "booked_class_move_app" };
  }
  if (isRegistrationFailedInquiry(raw)) {
    return { matcher: "membership_lookup", category: "membership_lookup" };
  }
  if (isScheduleInquiryIntent(raw)) {
    return { matcher: "schedule_lookup", category: "schedule_lookup" };
  }
  if (isJoinSignupIntentText(raw)) {
    return { matcher: "signup", category: "signup" };
  }
  if (isWholeMessageHumanRequest(raw)) {
    return { matcher: "human_agent", category: "human_agent" };
  }
  if (classifyInboundSpeechAct(raw) === "schedule_ask" || isScheduleIntent(raw)) {
    return { matcher: "day_timetable", category: "day_timetable" };
  }
  return null;
}
