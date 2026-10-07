import { normalizeTrialClassTime } from "@/lib/leads/arbox-trial-booking-identity";

/**
 * Trial gate for class cancel and reschedule.
 * Claude's route suffix and a stored future trial booking. No keyword list, no Arbox call.
 * One indexed read on arbox_trial_booking_identity (business_id, user_id), and only
 * when the caller is already on a class-cancel or reschedule path.
 */
export const CLASS_CHANGE_TRIAL_TEAM_MODEL = "class_change_trial_team_handoff";

const TABLE = "arbox_trial_booking_identity";
const ISRAEL_TZ = "Asia/Jerusalem";

type TrialIdentityRows = {
  data: Array<{ class_date?: unknown; class_time?: unknown }> | null;
  error: { message: string } | null;
};

type TrialIdentityQuery = {
  eq: (column: string, value: string | number) => TrialIdentityQuery;
  gte: (column: string, value: string) => TrialIdentityQuery;
  limit: (count: number) => PromiseLike<TrialIdentityRows>;
};

type TrialIdentityReader = {
  from: (table: string) => unknown;
};

export function claudeRouteMarksTrialClass(route: string | null | undefined): boolean {
  return route === "class_move_trial" || route === "booking_change_trial";
}

export function israelClassWallClock(now: Date): { ymd: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hm: `${hour}:${get("minute")}` };
}

/** Start is strictly after now in Asia/Jerusalem. Today at a time already passed is not future. */
export function trialClassStartIsFuture(classDate: string, classTime: string, now: Date): boolean {
  const date = String(classDate ?? "").trim().slice(0, 10);
  const time = normalizeTrialClassTime(classTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return false;
  const wall = israelClassWallClock(now);
  if (date > wall.ymd) return true;
  if (date < wall.ymd) return false;
  return time > wall.hm;
}

/**
 * True when this user has classification trial on a booking that has not started.
 * Uses idx_arbox_trial_booking_identity_user (business_id, user_id). class_date is
 * already on the row, so the future filter needs no migration.
 * A failed read logs and returns false so the webhook still answers.
 */
export async function contactHasFutureTrialBooking(input: {
  admin: TrialIdentityReader;
  businessId: number;
  userId: number;
  now: Date;
}): Promise<boolean> {
  const businessId = Number(input.businessId);
  const userId = Number(input.userId);
  if (!Number.isFinite(businessId) || businessId <= 0 || !Number.isFinite(userId) || userId <= 0) {
    return false;
  }
  const today = israelClassWallClock(input.now).ymd;
  const selected = (input.admin.from(TABLE) as { select: (columns: string) => TrialIdentityQuery }).select(
    "class_date, class_time, classification"
  );
  const { data, error } = await selected
    .eq("business_id", businessId)
    .eq("user_id", Math.trunc(userId))
    .eq("classification", "trial")
    .gte("class_date", today)
    .limit(20);
  if (error) {
    console.error("[class-change-trial] future trial booking lookup failed:", error.message);
    return false;
  }
  for (const row of data ?? []) {
    const classDate = String((row as { class_date?: unknown }).class_date ?? "");
    const classTime = String((row as { class_time?: unknown }).class_time ?? "");
    if (trialClassStartIsFuture(classDate, classTime, input.now)) return true;
  }
  return false;
}
