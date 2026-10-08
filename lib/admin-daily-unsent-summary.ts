/**
 * Daily admin WhatsApp: automated messages that did not go out in the last 24h.
 * Runs from the existing hourly class-cancel cron (cron-job.org). No new cron.
 * First attempt at or after 09:30 Asia/Jerusalem, once per Israel day, and only
 * when there is at least one row. One Meta template send on that day.
 *
 * IO after 09:30: one messages lookup for the day, then about a dozen indexed
 * log reads (processed_at / updated_at, last 24h) and one template-status read.
 * Delivery: failed statuses of the last 24h (status, status_at index), and sends
 * accepted 24–48h ago checked by wamid in chunks of 200 (primary key).
 * At 10x businesses the same queries stay on those indexes. No Claude.
 */
import { ADMIN_SUPPORT_ALERT_WHATSAPP, sendAdminWhatsAppTemplate } from "@/lib/notifications/sendAdminWhatsAppTemplate";
import { logMarketingWhatsAppMessage, MARKETING_CONVERSATIONS_SLUG } from "@/lib/marketing-whatsapp";
import { CRON_UNEXPECTED_CALLER_MODEL } from "@/lib/cron-clock";
import { listWabaTemplates } from "@/lib/meta-templates";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { EMPTY_VARIABLE_ERROR } from "@/lib/notifications/template-empty-variable";
import { PLAN_SUPERSEDED_REASON } from "@/lib/send-plan/errors";
import { ARBOX_ERROR_REASON } from "@/lib/leads/arbox-error-retry";
import { loadIncompleteRunsSince } from "@/lib/leads/arbox-daily-run-status";
import { isMissingStatusTable, WA_MESSAGE_STATUSES_TABLE } from "@/lib/wa-message-status";
import { BLOCKING_ALERT_MODEL } from "@/lib/wa-blocking-error-alert";
import { CRM_TASK_AUDIT_SESSION, CRM_TASK_FAILED_MODEL } from "@/lib/crm/arbox-task-retry";

const IL_TZ = "Asia/Jerusalem";
export const ADMIN_DAILY_UNSENT_TEMPLATE = "zoe_admin_daily_unsent";
export const ADMIN_DAILY_UNSENT_MODEL = "admin_daily_unsent";
const DETAIL_CAP = 800;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type UnsentRow = {
  businessId: number;
  business: string;
  trigger: string;
  /** template_triggers.template_name, for the per-rule history breakdown. */
  rule?: string;
  contact: string;
  reason: string;
  at: string;
  future?: boolean;
  metaError?: string;
};

export type UnsentGroup = "problem" | "manual" | "expected";

export const MANUAL_BLOCK_REASON = "נחסם ידנית";
/** Graph accepted the send, then Meta reported status=failed (error code in metaError). */
export const DELIVERY_FAILED_REASON = "נכשל במסירה";
/** Accepted 24–48h ago and no delivered / read / failed status since. */
export const UNDELIVERED_24H_REASON = "לא נמסר אחרי 24 שעות";
export const AUTO_CANCEL_REASON = "בוטל אוטומטית";
/** Immediate blocking-error alert went out in the last 24h (payment, lock, template paused…). */
export const BLOCKING_ALERT_REASON = "חסימה בחשבון וואטסאפ";
/** POST /v3/tasks failed after retries: staff did not get the Arbox task. */
export const CRM_TASK_FAILED_REASON = "משימה לא נפתחה";
const FUTURE_SEED_REASON = "סומן לפני מועד השליחה";
/** A rule that seeds more than this many rows in a day is listed by name in the summary. */
export const HISTORY_RULE_BREAKDOWN_MIN = 10;

/** Cancel reasons the code writes on purpose (opt-out, rule scope, schedule off). Not a failure. */
const AUTO_STOP_REASONS = new Set([
  "suppressed_opt_out",
  "suppressed_alert_mute",
  "schedule_disabled",
  "call_day_rescheduled",
  "rescheduled_to_call_day",
  "product_filter_scope",
  "active_product",
  "class_started",
]);
const FAILURE_REASON = /send_failed|claim_held|claim_failed|claim_lost|outcome_unknown|error|timeout|failed|missing|not_found/;
const STOP_TOKEN = /^[a-z][a-z0-9_]*(?:[|:][a-z0-9_]+)*$/;

/**
 * Why an abandoned / canceled row stopped. A Meta error, a send failure or an empty reason
 * is a real failure. A known code reason is automatic. Any other snake_case token was
 * written by a person or a one-off script to hold that send on purpose.
 */
function stopReasonKind(err: string): "auto" | "manual" | null {
  if (!err || FAILURE_REASON.test(err) || !STOP_TOKEN.test(err)) return null;
  return AUTO_STOP_REASONS.has(err) ? "auto" : "manual";
}

const EXPECTED_REASONS = new Set([
  "סומן בלי שליחה",
  "תקרת שימור יומית",
  "דילוג",
  "אימון בלי סימון",
  "הקפאה",
  "לא מנוי פעיל",
  "אימון עתידי",
  "צוות",
  "הסיר את עצמו",
  "בקשת עזיבה",
  AUTO_CANCEL_REASON,
]);

/** problem: counted in the headline. manual / expected: listed apart, never as not sent. */
export function unsentGroup(row: Pick<UnsentRow, "reason" | "future">): UnsentGroup {
  if (row.reason === MANUAL_BLOCK_REASON) return "manual";
  if (!row.future && EXPECTED_REASONS.has(row.reason)) return "expected";
  return "problem";
}

const SYNC_LOGS: Array<{ table: string; trigger: string }> = [
  { table: "arbox_trial_booking_confirm_log", trigger: "trial_booked" },
  { table: "arbox_trial_reminder_sync_log", trigger: "trial_reminder" },
  { table: "arbox_missed_class_sync_log", trigger: "missed_class" },
  { table: "arbox_lost_lead_sync_log", trigger: "lost_lead" },
  { table: "arbox_lead_status_change_sync_log", trigger: "lead_status_changed" },
  { table: "arbox_attendance_gap_sync_log", trigger: "attendance_gap" },
  { table: "arbox_freeze_created_sync_log", trigger: "freeze_created" },
  { table: "arbox_freeze_ending_sync_log", trigger: "freeze_ending" },
  { table: "arbox_post_trial_followup_sync_log", trigger: "post_trial" },
  { table: "arbox_cancellation_sync_log", trigger: "cancellation" },
  { table: "arbox_nth_workout_sync_log", trigger: "nth_workout" },
  { table: "arbox_days_in_club_sync_log", trigger: "days_in_club" },
  { table: "arbox_class_cancelled_customer_notify_log", trigger: "class_cancelled_customer" },
  { table: "arbox_birthday_sync_log", trigger: "birthday" },
  { table: "arbox_sessions_expiring_sync_log", trigger: "sessions_expiring" },
  { table: "arbox_credit_refusal_sync_log", trigger: "credit_refusal" },
  { table: "arbox_expiring_sync_log", trigger: "membership_expiring" },
  { table: "arbox_trial_sync_log", trigger: "purchase" },
  { table: "arbox_new_lead_sync_log", trigger: "arbox_new_lead" },
];

export function israelClock(now: Date): { hour: number; minute: number; ymd: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  return {
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export function adminDailySummaryDue(now: Date): boolean {
  const clock = israelClock(now);
  return clock.hour > 9 || (clock.hour === 9 && clock.minute >= 30);
}

/** DISPATCH runs at the slot; a planned row still unsent this long after its due time is a problem. */
const PLAN_DISPATCH_GRACE_MS = 30 * 60_000;

export const PLAN_HELD_REASON = "מוחזק לבדיקה";
export const PLAN_NOT_DISPATCHED_REASON = "תוכנן ולא נשלח";

/**
 * Plan-before-send rows (lib/send-plan): the planned row is the send, so its own outcome is
 * what counts. undefined: not a plan state, use the regular rules.
 */
function planRowReason(status: string, err: string, overdue: boolean): string | null | undefined {
  if (err === PLAN_SUPERSEDED_REASON) return null;
  if (status === "planned") return overdue ? PLAN_NOT_DISPATCHED_REASON : null;
  if (status === "held") return PLAN_HELD_REASON;
  if (status === "blocked") return "נחסם כפילות";
  if (err === "not_dispatched") return PLAN_NOT_DISPATCHED_REASON;
  if (err === "hold_expired") return "החזקה לא שוחררה ובוטלה";
  if (err === "release_not_relevant") return "שוחרר אחרי שכבר לא רלוונטי";
  if (err === "canceled_by_admin") return MANUAL_BLOCK_REASON;
  if (status === "skipped") {
    if (err.startsWith("opted_out") || err === "suppressed_opt_out") return "הסיר את עצמו";
    if (err.startsWith("leave_request")) return "בקשת עזיבה";
    if (err.startsWith("staff")) return "צוות";
    if (err === "class_started" || err === "booking_canceled") return "דילוג";
  }
  return undefined;
}

export function unsentReason(input: {
  status: string;
  lastError?: string | null;
  overdue: boolean;
}): string | null {
  const status = String(input.status ?? "").trim().toLowerCase();
  const err = String(input.lastError ?? "").trim().toLowerCase();
  const plan = planRowReason(status, err, input.overdue);
  if (plan !== undefined) return plan;
  if (status === "unknown" || err.includes("send_outcome_unknown")) return "תוצאה לא ידועה";
  if (err.includes(EMPTY_VARIABLE_ERROR)) return "משתנה ריק בטמפלייט";
  if (status === "sending") return "נשאר באמצע שליחה";
  if (status === "sent" && err === "sending") return null;
  if (err === "sending") return "נשאר באמצע שליחה";
  if (err === "duplicate_guard") return "נחסם כפילות";
  if (status === "sent") return null;
  if (err.includes(ARBOX_ERROR_REASON)) return "שגיאת ארבוקס";
  if (status === "pending" && !input.overdue) return null;
  if (err.includes("class_unmarked")) return "אימון בלי סימון";
  if (err === "frozen" || err.includes("freeze_blocks")) return "הקפאה";
  if (err.includes("not_active_member")) return "לא מנוי פעיל";
  if (err.includes("has_future_booking")) return "אימון עתידי";
  if (err === "staff") return "צוות";
  if (err.includes("retention_daily_cap")) return "תקרת שימור יומית";
  if (err === "activation_seed" || status === "seeded") return "סומן בלי שליחה";
  if (err.includes("no_valid_name") || err.includes("invalid_name")) return "שם לא תקין";
  if (err.includes("not_trial")) return "לא ניסיון";
  if (err.includes("placeholder") || err.includes("no_template")) return "פרמטרים לא תואמים";
  if (err.includes("not_approved") || err.includes("template_pending") || err.includes("gated")) {
    return "תבנית לא מאושרת";
  }
  if (err.includes("waba") || err.includes("no_channel")) return "חסר וואטסאפ";
  if (status === "no_phone" || err.includes("no_phone")) return "אין טלפון";
  if (err === "before_activation" || err === "activation_cutoff") return null;
  if (err === "status_changed_before_send") return null;
  if (err.includes("pull_integrity")) return "סריקת ארבוקס לא שלמה";
  if (err === "expired") return "פג תוקף כי הסריקה נכשלה";
  if (err.includes("mass_change")) return "שינוי סטטוס המוני";
  if (status === "canceled" || status === "cancelled" || status === "abandoned") {
    const kind = stopReasonKind(err);
    if (kind === "auto") return AUTO_CANCEL_REASON;
    if (kind === "manual") return MANUAL_BLOCK_REASON;
  }
  if (status === "canceled" || status === "cancelled") return "בוטל";
  if (status === "skipped") return "דילוג";
  if (status === "pending") return "ממתין אחרי 09:00";
  if (status === "failed" || status === "abandoned") return "נכשל";
  return null;
}

export function renderAdminDailyUnsentText(count: number, detail: string): string {
  return `דוח יומי מזואי: ב-24 השעות האחרונות ${count} הודעות אוטומטיות לא יצאו. פירוט: ${detail}. הפירוט המלא בדשבורד האדמין.`;
}

function squashParam(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

function countedLines(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "he"))
    .map(([key, count]) => squashParam(`${key} ${count}`));
}

/** Headline number: failed, unknown, stuck sending, missed. Manual holds and expected rows excluded. */
export function unsentProblemCount(rows: readonly UnsentRow[]): number {
  return rows.filter((row) => unsentGroup(row) === "problem").length;
}

export function unsentDetailParam(rows: readonly UnsentRow[]): string {
  const attention = new Map<string, number>();
  const manual = new Map<string, number>();
  const historyByRule = new Map<string, number>();
  let manualTotal = 0;
  let history = 0;
  let cap = 0;
  let skipped = 0;
  let unmarked = 0;
  let frozen = 0;
  let inactive = 0;
  let booked = 0;
  let staff = 0;
  let autoCancel = 0;
  for (const row of rows) {
    const group = unsentGroup(row);
    if (group === "problem") {
      const base = row.future && row.reason === "סומן בלי שליחה" ? FUTURE_SEED_REASON : row.reason;
      const reason = row.metaError ? `${base} ${row.metaError}` : base;
      const key = `${row.business} · ${row.trigger} · ${reason}`;
      attention.set(key, (attention.get(key) ?? 0) + 1);
      continue;
    }
    if (group === "manual") {
      const key = `${row.business} · ${row.trigger}`;
      manual.set(key, (manual.get(key) ?? 0) + 1);
      manualTotal += 1;
      continue;
    }
    if (row.reason === "תקרת שימור יומית") cap += 1;
    else if (row.reason === "דילוג") skipped += 1;
    else if (row.reason === "אימון בלי סימון") unmarked += 1;
    else if (row.reason === "הקפאה") frozen += 1;
    else if (row.reason === "לא מנוי פעיל") inactive += 1;
    else if (row.reason === "אימון עתידי") booked += 1;
    else if (row.reason === "צוות") staff += 1;
    else if (row.reason === AUTO_CANCEL_REASON) autoCancel += 1;
    else {
      history += 1;
      const key = `${row.business} · ${row.trigger}${row.rule ? ` (${row.rule})` : ""}`;
      historyByRule.set(key, (historyByRule.get(key) ?? 0) + 1);
    }
  }
  const lines = countedLines(attention);
  const bigRules = countedLines(
    new Map([...historyByRule].filter(([, count]) => count > HISTORY_RULE_BREAKDOWN_MIN))
  );
  // Detail level 2: everything. 1: manual holds as a count only. 0: no per-rule list either.
  const manualLine = (level: number) =>
    manualTotal === 0
      ? ""
      : level >= 2
        ? `${MANUAL_BLOCK_REASON}: ${manualTotal} (${countedLines(manual).join(", ")})`
        : `${MANUAL_BLOCK_REASON}: ${manualTotal}`;
  const expectedLine = (level: number) => {
    const byRule =
      level >= 1 && bigRules.length ? `; מעל ${HISTORY_RULE_BREAKDOWN_MIN} לכלל: ${bigRules.join(", ")}` : "";
    const auto = autoCancel ? `, ${autoCancel} ביטולים אוטומטיים` : "";
    return `צפוי: ${history} סימוני היסטוריה (כללים חדשים / זמן עבר${byRule}), ${unmarked} אימונים בלי סימון נוכחות, ${cap} דילוגי תקרת שימור, ${skipped} דילוגים, ${frozen} הקפאות, ${inactive} לא מנוי פעיל, ${booked} עם אימון עתידי, ${staff} צוות${auto}`;
  };
  const pointer = "הפירוט המלא ב-/admin/unsent";
  const join = (items: string[], level: number) =>
    squashParam([...items, manualLine(level), expectedLine(level)].filter(Boolean).join(" | "));
  let level = 2;
  while (level > 0 && join(lines, level).length > DETAIL_CAP) level -= 1;
  let kept = lines;
  while (kept.length > 0 && join(kept, level).length > DETAIL_CAP) kept = kept.slice(0, -1);
  let detail = join(kept, level);
  if (kept.length < lines.length || level < 2) {
    const withPointer = squashParam(`${detail} | ${pointer}`);
    detail = withPointer.length <= DETAIL_CAP ? withPointer : detail;
  }
  return detail.length <= DETAIL_CAP ? detail : detail.slice(0, DETAIL_CAP);
}

function israelStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: IL_TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function readLog(
  admin: Admin,
  table: string,
  sinceIso: string
): Promise<Array<Record<string, unknown>>> {
  // Every column: the tables differ (lead_id, reason, class_date), and a narrower select
  // that misses one column silently dropped reason and class time on most of them.
  const { data, error } = await admin.from(table).select("*").gte("processed_at", sinceIso).limit(2000);
  if (!error) return (data ?? []) as unknown as Array<Record<string, unknown>>;
  if (/does not exist|42P01/i.test(error.message)) return [];
  console.error("[admin-daily-unsent] log read failed", { table, error: error.message });
  return [];
}

type RawUnsent = {
  businessId: number;
  triggerId: string;
  triggerFallback: string;
  userId: string;
  phone: string;
  reason: string;
  at: string;
  classStart: string;
  metaError: string;
};

type SendRef = { wamid: string; business_id: number; phone: string; template_name: string; trigger_id: string | null; created_at: string };

const REF_SELECT = "wamid, business_id, phone, template_name, trigger_id, created_at";
const IN_CHUNK = 200;

function refToRaw(ref: SendRef, reason: string, at: string, metaError: string): RawUnsent {
  return {
    businessId: Number(ref.business_id),
    triggerId: String(ref.trigger_id ?? ""),
    triggerFallback: String(ref.template_name ?? "template"),
    userId: "",
    phone: String(ref.phone ?? ""),
    reason,
    at,
    classStart: "",
    metaError,
  };
}

/**
 * Automated sends (wa_template_send_refs) that Meta failed to deliver in the last 24h,
 * and sends accepted 24–48h ago that never reached delivered / read / failed.
 * The second check starts at the first stored status, so sends from before the
 * table existed are not reported as undelivered.
 */
export async function loadDeliveryProblems(admin: Admin, now: Date): Promise<RawUnsent[]> {
  const sinceIso = new Date(now.getTime() - 24 * 36e5).toISOString();
  const olderIso = new Date(now.getTime() - 48 * 36e5).toISOString();
  const out: RawUnsent[] = [];

  const { data: failed, error: failedErr } = await admin
    .from(WA_MESSAGE_STATUSES_TABLE)
    .select("wamid, error_code, status_at, received_at")
    .eq("status", "failed")
    .gte("status_at", sinceIso)
    .limit(2000);
  if (failedErr) {
    if (!isMissingStatusTable(failedErr.message)) {
      console.error("[admin-daily-unsent] delivery status read failed", failedErr.message);
    }
    return out;
  }
  const failedRows = (failed ?? []) as Array<{ wamid: string; error_code: number | null; status_at: string | null; received_at: string }>;
  const failedIds = [...new Set(failedRows.map((row) => row.wamid))];
  const refs = new Map<string, SendRef>();
  for (let i = 0; i < failedIds.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from("wa_template_send_refs")
      .select(REF_SELECT)
      .in("wamid", failedIds.slice(i, i + IN_CHUNK));
    if (error) {
      console.error("[admin-daily-unsent] send ref read failed", error.message);
      break;
    }
    for (const ref of (data ?? []) as SendRef[]) refs.set(ref.wamid, ref);
  }
  for (const row of failedRows) {
    const ref = refs.get(row.wamid);
    if (!ref) continue;
    const code = row.error_code == null ? "ללא קוד" : String(row.error_code);
    out.push(refToRaw(ref, DELIVERY_FAILED_REASON, row.status_at ?? row.received_at, code));
  }

  const { data: first, error: firstErr } = await admin
    .from(WA_MESSAGE_STATUSES_TABLE)
    .select("received_at")
    .order("received_at", { ascending: true })
    .limit(1);
  const trackedSince = String((first?.[0] as { received_at?: unknown } | undefined)?.received_at ?? "");
  if (firstErr || !trackedSince) return out;
  const fromIso = new Date(Math.max(Date.parse(olderIso), Date.parse(trackedSince))).toISOString();
  if (fromIso >= sinceIso) return out;

  const { data: aged, error: agedErr } = await admin
    .from("wa_template_send_refs")
    .select(REF_SELECT)
    .gte("created_at", fromIso)
    .lt("created_at", sinceIso)
    .limit(5000);
  if (agedErr) {
    console.error("[admin-daily-unsent] aged send ref read failed", agedErr.message);
    return out;
  }
  const agedRefs = (aged ?? []) as SendRef[];
  const settled = new Set<string>();
  for (let i = 0; i < agedRefs.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from(WA_MESSAGE_STATUSES_TABLE)
      .select("wamid")
      .in("wamid", agedRefs.slice(i, i + IN_CHUNK).map((ref) => ref.wamid))
      .in("status", ["delivered", "read", "failed"]);
    if (error) {
      console.error("[admin-daily-unsent] aged status read failed", error.message);
      return out;
    }
    for (const row of data ?? []) settled.add(String((row as { wamid?: unknown }).wamid ?? ""));
  }
  for (const ref of agedRefs) {
    if (!settled.has(ref.wamid)) out.push(refToRaw(ref, UNDELIVERED_24H_REASON, ref.created_at, ""));
  }
  return out;
}

export async function loadAdminDailyUnsent(admin: Admin, now: Date): Promise<UnsentRow[]> {
  const since = new Date(now.getTime() - 24 * 36e5);
  const sinceIso = since.toISOString();
  const overdueBefore = new Date(now.getTime() - 30 * 60_000).toISOString();
  const raw: RawUnsent[] = [];

  for (const source of SYNC_LOGS) {
    const rows = await readLog(admin, source.table, sinceIso);
    for (const row of rows) {
      const at = String(row.processed_at ?? "");
      const overdue = String(row.status ?? "") === "pending" && at <= overdueBefore;
      const reason = unsentReason({
        status: String(row.status ?? ""),
        lastError: String(row.reason ?? ""),
        overdue,
      });
      if (!reason) continue;
      const businessId = Number(row.business_id);
      if (!Number.isFinite(businessId)) continue;
      const userId = String(row.user_id ?? row.lead_id ?? row.contact_id ?? "").trim();
      const classDate = String(row.class_date ?? "").slice(0, 10);
      const classClock = String(row.class_time ?? "").trim().slice(0, 5);
      const classHm = /^\d{1,2}:\d{2}$/.test(classClock) ? classClock.padStart(5, "0") : "";
      raw.push({
        businessId,
        triggerId: String(row.trigger_id ?? ""),
        triggerFallback: source.trigger,
        userId,
        phone: "",
        reason,
        at,
        classStart: classDate && classHm ? `${classDate}T${classHm}:00+03:00` : "",
        metaError: "",
      });
    }
  }

  const { data: queued, error: queueErr } = await admin
    .from("scheduled_template_sends")
    .select("business_id, trigger_id, contact_phone, status, last_error, due_at, updated_at")
    .gte("updated_at", sinceIso)
    .limit(2000);
  if (queueErr) {
    console.error("[admin-daily-unsent] scheduled read failed", queueErr.message);
  }
  for (const row of queued ?? []) {
    const dueAt = String((row as { due_at?: unknown }).due_at ?? "");
    const rowStatus = String((row as { status?: unknown }).status ?? "");
    const overdue =
      (rowStatus === "pending" && dueAt <= now.toISOString()) ||
      (rowStatus === "planned" && dueAt <= new Date(now.getTime() - PLAN_DISPATCH_GRACE_MS).toISOString());
    const reason = unsentReason({
      status: String((row as { status?: unknown }).status ?? ""),
      lastError: String((row as { last_error?: unknown }).last_error ?? ""),
      overdue,
    });
    if (!reason) continue;
    raw.push({
      businessId: Number((row as { business_id?: unknown }).business_id),
      triggerId: String((row as { trigger_id?: unknown }).trigger_id ?? ""),
      triggerFallback: "scheduled",
      userId: "",
      phone: String((row as { contact_phone?: unknown }).contact_phone ?? ""),
      reason,
      at: String((row as { updated_at?: unknown }).updated_at ?? dueAt),
      classStart: dueAt,
      metaError: String((row as { last_error?: unknown }).last_error ?? ""),
    });
  }

  raw.push(...(await loadDeliveryProblems(admin, now)));

  const businessIds = [...new Set(raw.map((row) => row.businessId).filter((id) => id > 0))];
  const triggerIds = [...new Set(raw.map((row) => row.triggerId).filter(Boolean))];
  const userIds = [...new Set(raw.map((row) => Number(row.userId)).filter((id) => id > 0))];
  const names = new Map<number, string>();
  const triggers = new Map<string, string>();
  const ruleNames = new Map<string, string>();
  const contacts = new Map<string, string>();

  if (businessIds.length) {
    const { data } = await admin.from("businesses").select("id, name, slug").in("id", businessIds);
    for (const row of data ?? []) {
      const label = String(row.name ?? "").trim() || String(row.slug ?? row.id);
      names.set(Number(row.id), label);
    }
  }
  if (triggerIds.length) {
    const { data } = await admin
      .from("template_triggers")
      .select("id, trigger_type, template_name")
      .in("id", triggerIds);
    for (const row of data ?? []) {
      triggers.set(String(row.id), String(row.trigger_type ?? ""));
      const name = String(row.template_name ?? "").trim();
      if (name) ruleNames.set(String(row.id), name);
    }
  }
  for (let i = 0; i < userIds.length; i += 200) {
    const slice = userIds.slice(i, i + 200);
    const { data } = await admin
      .from("contacts")
      .select("business_id, arbox_user_id, full_name, phone")
      .in("arbox_user_id", slice);
    for (const row of data ?? []) {
      const key = `${row.business_id}|${row.arbox_user_id}`;
      const full = String(row.full_name ?? "").trim();
      const phone = String(row.phone ?? "").replace(/\D/g, "");
      contacts.set(key, full || (phone ? `***${phone.slice(-4)}` : ""));
    }
  }

  const seen = new Set<string>();
  const out: UnsentRow[] = [];
  const triggerIdOf = new WeakMap<UnsentRow, string>();
  for (const row of raw) {
    const trigger = triggers.get(row.triggerId) || row.triggerFallback;
    const named = contacts.get(`${row.businessId}|${Number(row.userId)}`) ?? "";
    const phoneTail = row.phone.replace(/\D/g, "").slice(-4);
    const contact =
      named ||
      (phoneTail ? `***${phoneTail}` : "") ||
      (row.userId && row.userId !== "0" ? `משתמש ${row.userId}` : "הפעלת כלל");
    const key = `${row.businessId}|${trigger}|${contact}|${row.reason}|${row.at.slice(0, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const classAt = row.classStart ? new Date(row.classStart) : null;
    const future =
      row.reason === "סומן בלי שליחה" &&
      classAt != null &&
      !Number.isNaN(classAt.getTime()) &&
      classAt.getTime() > now.getTime();
    const meta =
      row.reason === "נכשל" || row.reason === DELIVERY_FAILED_REASON ? squashParam(row.metaError).slice(0, 80) : "";
    const unsent: UnsentRow = {
      businessId: row.businessId,
      business: names.get(row.businessId) || String(row.businessId),
      trigger,
      rule: ruleNames.get(row.triggerId),
      contact,
      reason: row.reason,
      at: israelStamp(row.at),
      future,
      metaError: meta && !/^(activation_seed|retention_daily_cap|send_failed)$/i.test(meta) ? meta : "",
    };
    triggerIdOf.set(unsent, row.triggerId);
    out.push(unsent);
  }

  const { data: failures, error: failureErr } = await admin
    .from("template_send_failures")
    .select("business_id, trigger_id, meta_code, meta_message, created_at")
    .gte("created_at", sinceIso)
    .limit(200);
  if (failureErr && !/does not exist|schema cache/i.test(failureErr.message)) {
    console.error("[admin-daily-unsent] failure read failed", failureErr.message);
  }
  const failureByBusiness = new Map<number, string>();
  const failureByTrigger = new Map<string, string>();
  for (const row of failures ?? []) {
    const id = Number((row as { business_id?: unknown }).business_id);
    const code = String((row as { meta_code?: unknown }).meta_code ?? "").trim();
    const message = String((row as { meta_message?: unknown }).meta_message ?? "").trim();
    if (!Number.isFinite(id) || !code) continue;
    const text = squashParam(message ? `${code}: ${message}` : code).slice(0, 80);
    failureByBusiness.set(id, text);
    const triggerId = String((row as { trigger_id?: unknown }).trigger_id ?? "").trim();
    if (triggerId) failureByTrigger.set(triggerId, text);
  }
  for (const row of out) {
    if (row.reason === "נכשל" && !row.metaError) {
      const triggerId = triggerIdOf.get(row) ?? "";
      row.metaError = (triggerId && failureByTrigger.get(triggerId)) || failureByBusiness.get(row.businessId) || "";
    }
  }

  const { data: marketing, error: marketingErr } = await admin
    .from("scheduled_marketing_template_sends")
    .select("contact_phone, template_name, status, last_error, updated_at")
    .eq("status", "failed")
    .gte("updated_at", sinceIso)
    .limit(200);
  if (marketingErr && !/does not exist|schema cache/i.test(marketingErr.message)) {
    console.error("[admin-daily-unsent] marketing queue read failed", marketingErr.message);
  }
  for (const row of marketing ?? []) {
    const lastError = String((row as { last_error?: unknown }).last_error ?? "");
    if (!/empty_variable|send_outcome_unknown/i.test(lastError)) continue;
    const reason = unsentReason({ status: "failed", lastError, overdue: false });
    if (!reason) continue;
    const phoneTail = String((row as { contact_phone?: unknown }).contact_phone ?? "").replace(/\D/g, "").slice(-4);
    out.push({
      businessId: 0,
      business: "HeyZoe",
      trigger: String((row as { template_name?: unknown }).template_name ?? "marketing"),
      contact: phoneTail ? `***${phoneTail}` : "",
      reason,
      at: israelStamp(String((row as { updated_at?: unknown }).updated_at ?? "")),
      metaError: "",
    });
  }

  const incompleteRuns = await loadIncompleteRunsSince(admin, sinceIso);
  if (incompleteRuns.length) {
    const missing = [...new Set(incompleteRuns.map((row) => row.business_id))].filter((id) => !names.has(id));
    if (missing.length) {
      const { data } = await admin.from("businesses").select("id, name, slug").in("id", missing);
      for (const row of data ?? []) {
        names.set(Number(row.id), String(row.name ?? "").trim() || String(row.slug ?? row.id));
      }
    }
    for (const row of incompleteRuns) {
      out.push({
        businessId: row.business_id,
        business: names.get(row.business_id) || String(row.business_id),
        trigger: row.slot === "evening" ? "ריצת ערב" : "ריצת בוקר",
        contact: "",
        reason: "ריצה לא הושלמה",
        at: israelStamp(row.updated_at),
        metaError: squashParam(row.reason).slice(0, 80),
      });
    }
  }

  out.sort((a, b) => a.business.localeCompare(b.business, "he") || a.trigger.localeCompare(b.trigger));
  const { data: unexpected, error: unexpectedError } = await admin
    .from("messages")
    .select("content, created_at")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("model_used", CRON_UNEXPECTED_CALLER_MODEL)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(20);
  if (unexpectedError) {
    console.error("[admin-daily-unsent] unexpected cron lookup failed", unexpectedError.message);
  }
  for (const row of unexpected ?? []) {
    out.push({
      businessId: 0,
      business: "HeyZoe",
      trigger: "קרון",
      contact: "",
      reason: "קריאה לא מ-cron-job.org",
      at: String((row as { created_at?: unknown }).created_at ?? ""),
      metaError: squashParam(String((row as { content?: unknown }).content ?? "")).slice(0, 140),
    });
  }
  const { data: taskFailures, error: taskFailuresError } = await admin
    .from("messages")
    .select("content, created_at, model_used")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("session_id", CRM_TASK_AUDIT_SESSION)
    .like("model_used", `${CRM_TASK_FAILED_MODEL}%`)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);
  if (taskFailuresError) {
    console.error("[admin-daily-unsent] crm task failure lookup failed", taskFailuresError.message);
  }
  for (const row of taskFailures ?? []) {
    const businessRaw = String((row as { model_used?: unknown }).model_used ?? "").split(":")[1] ?? "";
    const businessId = Number(businessRaw);
    out.push({
      businessId: Number.isFinite(businessId) ? businessId : 0,
      business: names.get(businessId) || (businessRaw ? `עסק ${businessRaw}` : "HeyZoe"),
      trigger: "משימת ארבוקס",
      contact: "",
      reason: CRM_TASK_FAILED_REASON,
      at: israelStamp(String((row as { created_at?: unknown }).created_at ?? "")),
      metaError: squashParam(String((row as { content?: unknown }).content ?? "")).slice(0, 140),
    });
  }
  const { data: blocking, error: blockingError } = await admin
    .from("messages")
    .select("content, created_at, model_used")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .like("model_used", `${BLOCKING_ALERT_MODEL}:%`)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);
  if (blockingError) {
    console.error("[admin-daily-unsent] blocking alert lookup failed", blockingError.message);
  }
  for (const row of blocking ?? []) {
    const [, businessRaw, code] = String((row as { model_used?: unknown }).model_used ?? "").split(":");
    const businessId = Number(businessRaw);
    out.push({
      businessId: Number.isFinite(businessId) ? businessId : 0,
      business: names.get(businessId) || `עסק ${businessRaw ?? ""}`.trim(),
      trigger: "וואטסאפ",
      contact: "",
      reason: BLOCKING_ALERT_REASON,
      at: israelStamp(String((row as { created_at?: unknown }).created_at ?? "")),
      metaError:
        squashParam(String((row as { content?: unknown }).content ?? "")).slice(0, 140) || (code ? `קוד ${code}` : ""),
    });
  }
  return out;
}

async function alreadySentToday(admin: Admin, dayStartIso: string): Promise<string | null> {
  const { data, error } = await admin
    .from("messages")
    .select("content, created_at")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("model_used", ADMIN_DAILY_UNSENT_MODEL)
    .gte("created_at", dayStartIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[admin-daily-unsent] dedup lookup failed", error.message);
    return null;
  }
  const content = String(data?.[0]?.content ?? "").trim();
  return content || null;
}

function israelDayStartIso(now: Date): string {
  const ymd = israelClock(now).ymd;
  const [year, month, day] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: IL_TZ,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  })
    .formatToParts(guess)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT+3";
  const match = offset.match(/GMT([+-])(\d{1,2})/);
  const minutes = match ? (match[1] === "-" ? -1 : 1) * Number(match[2]) * 60 : 180;
  return new Date(guess.getTime() - minutes * 60_000).toISOString();
}

export async function maybeSendAdminDailyUnsentSummary(input: {
  admin: Admin;
  now?: Date;
  dryRun?: boolean;
}): Promise<{
  due: boolean;
  sent: boolean;
  already: boolean;
  count: number;
  text: string;
  templateStatus: string;
  reason: string;
}> {
  const now = input.now ?? new Date();
  const empty = {
    due: adminDailySummaryDue(now),
    sent: false,
    already: false,
    count: 0,
    text: "",
    templateStatus: "",
    reason: "",
  };
  if (!empty.due) return { ...empty, reason: "before_0930" };

  const prior = await alreadySentToday(input.admin, israelDayStartIso(now));
  if (prior) {
    return { ...empty, already: true, text: prior, reason: "already_sent_today" };
  }

  const rows = await loadAdminDailyUnsent(input.admin, now);
  if (!rows.length) return { ...empty, reason: "nothing_to_report" };

  const problems = unsentProblemCount(rows);
  const detail = unsentDetailParam(rows);
  const text = renderAdminDailyUnsentText(problems, detail);
  let templateStatus = "UNKNOWN";
  try {
    const wabaId = await resolveMarketingWabaId();
    if (!wabaId) templateStatus = "NO_WABA";
    else {
      const templates = await listWabaTemplates(wabaId);
      templateStatus =
        templates.find((row) => row.name === ADMIN_DAILY_UNSENT_TEMPLATE && row.language === "he")?.status ||
        "MISSING";
    }
  } catch (error) {
    templateStatus = "LOOKUP_FAILED";
    console.error("[admin-daily-unsent] template lookup failed", error instanceof Error ? error.message : error);
  }
  if (templateStatus !== "APPROVED") {
    console.info("[admin-daily-unsent] held until template is approved", { templateStatus, count: problems });
    return { ...empty, count: problems, text, templateStatus, reason: "template_not_approved" };
  }
  if (input.dryRun) {
    return { ...empty, count: problems, text, templateStatus, reason: "dry_run" };
  }

  const sent = await sendAdminWhatsAppTemplate({
    to: ADMIN_SUPPORT_ALERT_WHATSAPP,
    templateName: ADMIN_DAILY_UNSENT_TEMPLATE,
    languageCode: "he",
    bodyParams: [String(problems), detail],
  });
  if (!sent.ok) {
    console.error("[admin-daily-unsent] send failed", sent.error);
    return { ...empty, count: problems, text, templateStatus, reason: sent.error || "send_failed" };
  }
  await logMarketingWhatsAppMessage({
    leadPhone: ADMIN_SUPPORT_ALERT_WHATSAPP,
    role: "assistant",
    content: text,
    model_used: ADMIN_DAILY_UNSENT_MODEL,
  });
  console.info("[admin-daily-unsent] sent", { count: problems });
  return { ...empty, sent: true, count: problems, text, templateStatus, reason: "sent" };
}
