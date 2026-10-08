/**
 * Zoe's WhatsApp follow-up series (wa_followup_1..3) runs once per contact, ever.
 * contacts.followup_series_locked_at is set (only when null) when the first follow-up
 * of a series is sent, and on any human involvement (human request, staff reply from the
 * WhatsApp app, dashboard send). A series may start only while it is null.
 *
 * wa_followup_stage stays free to reset for status tags; the lock is the only follow-up gate.
 * Until the column exists every helper here is a no-op and the cron behaves as before.
 */
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { HUMAN_REPLY_FOLLOWUP_HOLD_STAGE } from "@/lib/human-requested";

type Admin = import("@supabase/supabase-js").SupabaseClient;

export const FOLLOWUP_SERIES_LOCK_COLUMN = "followup_series_locked_at";

const COLUMN_PROBE_TTL_MS = 5 * 60 * 1000;
let columnProbe: { exists: boolean; at: number } | null = null;

export function isMissingFollowupLockColumnError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  const message = String(error.message ?? "");
  if (!message.includes(FOLLOWUP_SERIES_LOCK_COLUMN)) return String(error.code ?? "") === "42703";
  return /does not exist|schema cache|column/i.test(message) || ["42703", "PGRST204"].includes(String(error.code ?? ""));
}

/** True once contacts.followup_series_locked_at exists. Cached per instance for 5 minutes. */
export async function followupSeriesLockColumnExists(admin: Admin): Promise<boolean> {
  if (columnProbe && Date.now() - columnProbe.at < COLUMN_PROBE_TTL_MS) return columnProbe.exists;
  const { error } = await admin.from("contacts").select(FOLLOWUP_SERIES_LOCK_COLUMN).limit(1);
  if (error && !isMissingFollowupLockColumnError(error)) {
    console.error("[followup-series-lock] column probe failed:", error.message);
    return false;
  }
  columnProbe = { exists: !error, at: Date.now() };
  return columnProbe.exists;
}

export function resetFollowupSeriesLockProbeForTests(exists: boolean | null): void {
  columnProbe = exists === null ? null : { exists, at: Date.now() };
}

/** PostgREST `.or()` for the cron: unlocked contacts, or a series already in progress. */
export const FOLLOWUP_SERIES_OPEN_OR_IN_PROGRESS = `${FOLLOWUP_SERIES_LOCK_COLUMN}.is.null,wa_followup_stage.gt.0`;

export type FollowupSeriesGate =
  /** Column missing: today's behavior. */
  | "no_lock_column"
  /** Unlocked: claim the lock (CAS) right before the first send. */
  | "start_series"
  /** Locked by this series' first send; stages 2–3 continue. */
  | "continue_series"
  /** Locked and no series in progress: no follow-up, no stage advance. */
  | "locked";

/**
 * Stage 1–2 with a lock means the series this lock belongs to is still running: human
 * involvement moves stages 1–2 to the terminal hold stage, and every inbound reset goes to 0.
 */
export function decideFollowupSeriesGate(input: {
  lockColumn: boolean;
  lockedAt: string | null | undefined;
  stageCurrent: number;
}): FollowupSeriesGate {
  if (!input.lockColumn) return "no_lock_column";
  if (!String(input.lockedAt ?? "").trim()) return "start_series";
  return input.stageCurrent === 1 || input.stageCurrent === 2 ? "continue_series" : "locked";
}

/** One CAS write. False when another path locked first (then nothing is sent). */
export async function claimFollowupSeriesStart(input: {
  admin: Admin;
  contactId: string | number;
  nowIso: string;
}): Promise<{ claimed: boolean; error?: string }> {
  const { data, error } = await input.admin
    .from("contacts")
    .update({ [FOLLOWUP_SERIES_LOCK_COLUMN]: input.nowIso })
    .eq("id", input.contactId)
    .is(FOLLOWUP_SERIES_LOCK_COLUMN, null)
    .select("id");
  if (error) {
    console.error("[followup-series-lock] claim failed:", error.message, { contact_id: input.contactId });
    return { claimed: false, error: error.message };
  }
  return { claimed: Boolean(data?.length) };
}

/**
 * The send after a claim failed: give the series back. CAS on the exact value the claim
 * wrote. Human involvement meanwhile keeps the lock (it was already set) but clears the
 * due time, so when the row was picked with a due time, release also needs it still set.
 */
export async function releaseFollowupSeriesClaim(input: {
  admin: Admin;
  contactId: string | number;
  claimedAtIso: string;
  dueWasSet: boolean;
}): Promise<{ released: boolean; error?: string }> {
  let q = input.admin
    .from("contacts")
    .update({ [FOLLOWUP_SERIES_LOCK_COLUMN]: null })
    .eq("id", input.contactId)
    .eq(FOLLOWUP_SERIES_LOCK_COLUMN, input.claimedAtIso);
  if (input.dueWasSet) q = q.not("wa_next_followup_at", "is", null);
  const { data, error } = await q.select("id");
  if (error) {
    console.error("[followup-series-lock] release failed:", error.message, { contact_id: input.contactId });
    return { released: false, error: error.message };
  }
  return { released: Boolean(data?.length) };
}

/**
 * Human involvement: lock (CAS, only when null) and cancel a pending series.
 * Stages 1–2 move to the hold stage (no «ללא מענה» paint); stage 0 loses its due time.
 * The DB trigger nulls wa_next_followup_at for stage >= 3 and does not fire on the
 * lock / due-time columns alone, so nothing re-schedules it.
 */
export async function lockFollowupSeriesForHumanInvolvement(input: {
  admin: Admin;
  businessId: number;
  phone: string;
  nowIso: string;
  reason: "human_requested" | "staff_app_reply" | "dashboard_send";
}): Promise<{ locked: number; cancelled: number; skipped?: "no_lock_column" | "invalid" }> {
  const businessId = Number(input.businessId);
  const phones = contactPhoneLookupVariants(input.phone);
  if (!businessId || !phones.length) return { locked: 0, cancelled: 0, skipped: "invalid" };
  if (!(await followupSeriesLockColumnExists(input.admin))) {
    return { locked: 0, cancelled: 0, skipped: "no_lock_column" };
  }

  const lockRes = await input.admin
    .from("contacts")
    .update({ [FOLLOWUP_SERIES_LOCK_COLUMN]: input.nowIso })
    .eq("business_id", businessId)
    .in("phone", phones)
    .is(FOLLOWUP_SERIES_LOCK_COLUMN, null)
    .select("id");
  if (lockRes.error) {
    console.error("[followup-series-lock] human lock failed:", lockRes.error.message, { reason: input.reason });
  }

  const cancelRes = await input.admin
    .from("contacts")
    .update({ wa_followup_stage: HUMAN_REPLY_FOLLOWUP_HOLD_STAGE, wa_next_followup_at: null })
    .eq("business_id", businessId)
    .in("phone", phones)
    .in("wa_followup_stage", [1, 2])
    .select("id");
  if (cancelRes.error) {
    console.error("[followup-series-lock] cancel in-progress series failed:", cancelRes.error.message);
  }

  const pendingRes = await input.admin
    .from("contacts")
    .update({ wa_next_followup_at: null })
    .eq("business_id", businessId)
    .in("phone", phones)
    .or("wa_followup_stage.eq.0,wa_followup_stage.is.null")
    .not("wa_next_followup_at", "is", null);
  if (pendingRes.error) {
    console.error("[followup-series-lock] clear pending follow-up failed:", pendingRes.error.message);
  }

  const result = { locked: lockRes.data?.length ?? 0, cancelled: cancelRes.data?.length ?? 0 };
  if (result.locked || result.cancelled) {
    console.info("[followup-series-lock] human involvement", { reason: input.reason, business_id: businessId, ...result });
  }
  return result;
}
