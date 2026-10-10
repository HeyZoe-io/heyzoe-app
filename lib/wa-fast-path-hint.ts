import type { ExtractedReplyRoute } from "@/lib/wa-reply-route";

/**
 * A keyword matcher that used to send before Claude.
 * It now only proposes a category. Claude confirms in the same call.
 */
export type FastPathHint = {
  matcher: string;
  category: string;
};

/**
 * Hints whose judged misfire on the latest message was above 30%.
 * Re-enable by deleting the category from this set.
 * day_timetable: 15/20 on 10 Oct 2026 (Haiku 5.5, effort low).
 */
export const DISABLED_FAST_PATH_HINTS = new Set<string>([
  // 15/20 on 10 Oct 2026. Re-enable by deleting the line.
  "day_timetable",
  // Reviewed 3/4. A registration word inside a cancel or a later plan.
  "registration_verify",
  // Reviewed 2/4. "מה יש היום" and a trainer asking how to register someone else.
  "membership_lookup",
  // 1/1. "ואני לא יכול להגיע" is not a schedule lookup.
  "schedule_lookup",
  // 1/3. "מחירי מנויים" is not a request for a person. A whole-message "נציג" still sends.
  "human_agent",
]);

/** Closed-playbook categories whose 60-day misfire rate was above 5%. */
const DEMOTED_PLAYBOOK = new Set([
  "cancellation",
  "freeze",
  "medical",
  "class_cancel",
  "reschedule",
  "discount",
]);

export function isDemotedClosedPlaybook(category: string): boolean {
  return DEMOTED_PLAYBOOK.has(category);
}

/**
 * A class-move hint is confirmed by booking_change.
 * A membership, freeze, medical, or lookup hint is confirmed by handoff only.
 * booking_change on those would send the wrong closed copy (a class cancel that
 * shares the word "לבטל" is not a membership cancellation).
 * A missing tag still uses the hint. signup confirms only route signup.
 * A clear signup route is not overridden by a registration hint.
 */
const BOOKING_CHANGE_HINTS = new Set([
  "reschedule",
  "class_cancel",
  "class_change_app_failed",
  "booked_class_move_app",
  "booking_mutation",
]);

const CLASS_MOVE_ROUTES = new Set(["class_move", "class_move_member", "class_move_trial"]);

export function decideHintAction(input: {
  hint: FastPathHint | null;
  extracted: Pick<ExtractedReplyRoute, "route" | "tagStatus">;
}): "use_hint" | "ignore_hint" {
  if (!input.hint) return "ignore_hint";
  const route = input.extracted.route;
  const tagStatus = input.extracted.tagStatus;
  if (
    input.hint.category === "schedule" ||
    input.hint.category === "day_timetable" ||
    DISABLED_FAST_PATH_HINTS.has(input.hint.category)
  ) {
    return "ignore_hint";
  }
  if (input.hint.category === "trial_slot") {
    const route = input.extracted.route;
    return input.extracted.tagStatus === "ok" &&
      (route === "signup" || route === "schedule" || route === "answer")
      ? "use_hint"
      : "ignore_hint";
  }
  if (input.hint.category === "registration_verify") {
    return tagStatus === "ok" && route === "registration_check" ? "use_hint" : "ignore_hint";
  }
  if (input.hint.category === "schedule_lookup") {
    return tagStatus === "ok" && route === "my_schedule" ? "use_hint" : "ignore_hint";
  }
  if (
    input.hint.category === "membership_lookup" ||
    input.hint.category === "membership_lookup_followup"
  ) {
    return tagStatus === "ok" && route === "handoff" ? "use_hint" : "ignore_hint";
  }
  // A member asking about her own membership is tagged answer; policy_question stays with the knowledge.
  if (input.hint.category === "membership_end_date") {
    return tagStatus === "ok" && (route === "answer" || route === "handoff") ? "use_hint" : "ignore_hint";
  }
  if (input.hint.category === "signup") {
    return tagStatus === "ok" && route === "signup" ? "use_hint" : "ignore_hint";
  }
  if (tagStatus !== "ok" || !route) return "use_hint";
  // Class move is Claude's tag. A keyword hint must not replace that route.
  if (CLASS_MOVE_ROUTES.has(route)) return "ignore_hint";
  if (route === "handoff") return "use_hint";
  if (
    (route === "booking_change" || route === "booking_change_trial") &&
    BOOKING_CHANGE_HINTS.has(input.hint.category)
  ) {
    return "use_hint";
  }
  return "ignore_hint";
}

export function formatFastPathHintLine(hint: FastPathHint): string {
  return `ניחוש ממילות מפתח בלבד (${hint.category}), והוא עלול לטעות. עני על ההודעה האחרונה, לא על שאלה ישנה שכבר לא רלוונטית. אם הניחוש לא מתאים להודעה האחרונה, התעלמי ממנו.`;
}
