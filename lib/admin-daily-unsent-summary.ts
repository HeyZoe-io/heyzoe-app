/**
 * Daily admin WhatsApp: automated messages that did not go out in the last 24h.
 * Runs from the existing hourly class-cancel cron (cron-job.org). No new cron.
 * First attempt at or after 09:30 Asia/Jerusalem, once per Israel day, and only
 * when there is at least one row. One Meta template send on that day.
 *
 * IO after 09:30: one messages lookup for the day, then about a dozen indexed
 * log reads (processed_at / updated_at, last 24h) and one template-status read.
 * At 10x businesses the same queries stay on those indexes. No Claude.
 */
import { ADMIN_SUPPORT_ALERT_WHATSAPP, sendAdminWhatsAppTemplate } from "@/lib/notifications/sendAdminWhatsAppTemplate";
import { logMarketingWhatsAppMessage, MARKETING_CONVERSATIONS_SLUG } from "@/lib/marketing-whatsapp";
import { listWabaTemplates } from "@/lib/meta-templates";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

const IL_TZ = "Asia/Jerusalem";
export const ADMIN_DAILY_UNSENT_TEMPLATE = "zoe_admin_daily_unsent";
export const ADMIN_DAILY_UNSENT_MODEL = "admin_daily_unsent";
const DETAIL_CAP = 800;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type UnsentRow = {
  businessId: number;
  business: string;
  trigger: string;
  contact: string;
  reason: string;
  at: string;
};

const SYNC_LOGS: Array<{ table: string; trigger: string }> = [
  { table: "arbox_trial_booking_confirm_log", trigger: "trial_booked" },
  { table: "arbox_trial_reminder_sync_log", trigger: "trial_reminder" },
  { table: "arbox_missed_class_sync_log", trigger: "missed_class" },
  { table: "arbox_lost_lead_sync_log", trigger: "lost_lead" },
  { table: "arbox_attendance_gap_sync_log", trigger: "attendance_gap" },
  { table: "arbox_freeze_created_sync_log", trigger: "freeze_created" },
  { table: "arbox_freeze_ending_sync_log", trigger: "freeze_ending" },
  { table: "arbox_post_trial_followup_sync_log", trigger: "post_trial" },
  { table: "arbox_cancellation_sync_log", trigger: "cancellation" },
  { table: "arbox_nth_workout_sync_log", trigger: "nth_workout" },
  { table: "arbox_days_in_club_sync_log", trigger: "days_in_club" },
  { table: "arbox_class_cancelled_customer_notify_log", trigger: "class_cancelled_customer" },
];

const LOG_SELECTS = [
  "business_id, status, processed_at, user_id, trigger_id, contact_id, channel",
  "business_id, status, processed_at, user_id, trigger_id, contact_id",
  "business_id, status, processed_at, user_id, contact_id",
  "business_id, status, processed_at, user_id",
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

export function unsentReason(input: {
  status: string;
  lastError?: string | null;
  overdue: boolean;
}): string | null {
  const status = String(input.status ?? "").trim().toLowerCase();
  const err = String(input.lastError ?? "").trim().toLowerCase();
  if (status === "sent") return null;
  if (status === "pending" && !input.overdue) return null;
  if (err === "activation_seed" || status === "seeded") return "סומן בלי שליחה";
  if (err.includes("no_valid_name") || err.includes("invalid_name")) return "שם לא תקין";
  if (err.includes("not_trial")) return "לא ניסיון";
  if (err.includes("placeholder") || err.includes("no_template")) return "פרמטרים לא תואמים";
  if (err.includes("not_approved") || err.includes("template_pending") || err.includes("gated")) {
    return "תבנית לא מאושרת";
  }
  if (err.includes("waba") || err.includes("no_channel")) return "חסר וואטסאפ";
  if (status === "no_phone" || err.includes("no_phone")) return "אין טלפון";
  if (status === "canceled" || status === "cancelled") return "בוטל";
  if (status === "skipped") return "דילוג";
  if (status === "pending") return "ממתין אחרי 09:00";
  if (status === "failed" || status === "abandoned") return "נכשל";
  return null;
}

export function renderAdminDailyUnsentText(count: number, detail: string): string {
  return `דוח יומי מזואי: ב-24 השעות האחרונות ${count} הודעות אוטומטיות לא יצאו. פירוט: ${detail}. הפירוט המלא בדשבורד האדמין.`;
}

export function unsentDetailParam(rows: readonly UnsentRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.business} · ${row.trigger} · ${row.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "he"))
    .map(([key, count]) => `${key} ${count}`);
  let detail = parts.join(" | ");
  detail = detail.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (detail.length > DETAIL_CAP) detail = `${detail.slice(0, DETAIL_CAP - 1)}…`;
  return detail || "אין פירוט";
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
  for (const columns of LOG_SELECTS) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .gte("processed_at", sinceIso)
      .limit(2000);
    if (!error) return (data ?? []) as Array<Record<string, unknown>>;
    if (/column|schema cache/i.test(error.message)) continue;
    if (/does not exist|42P01/i.test(error.message)) return [];
    console.error("[admin-daily-unsent] log read failed", { table, error: error.message });
    return [];
  }
  return [];
}

export async function loadAdminDailyUnsent(admin: Admin, now: Date): Promise<UnsentRow[]> {
  const since = new Date(now.getTime() - 24 * 36e5);
  const sinceIso = since.toISOString();
  const overdueBefore = new Date(now.getTime() - 30 * 60_000).toISOString();
  const raw: Array<{
    businessId: number;
    triggerId: string;
    triggerFallback: string;
    userId: string;
    phone: string;
    reason: string;
    at: string;
  }> = [];

  for (const source of SYNC_LOGS) {
    const rows = await readLog(admin, source.table, sinceIso);
    for (const row of rows) {
      const at = String(row.processed_at ?? "");
      const overdue = String(row.status ?? "") === "pending" && at <= overdueBefore;
      const reason = unsentReason({ status: String(row.status ?? ""), overdue });
      if (!reason) continue;
      const businessId = Number(row.business_id);
      if (!Number.isFinite(businessId)) continue;
      const userId = String(row.user_id ?? row.contact_id ?? "").trim();
      raw.push({
        businessId,
        triggerId: String(row.trigger_id ?? ""),
        triggerFallback: source.trigger,
        userId,
        phone: "",
        reason,
        at,
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
    const overdue = String((row as { status?: unknown }).status ?? "") === "pending" && dueAt <= now.toISOString();
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
    });
  }

  const businessIds = [...new Set(raw.map((row) => row.businessId).filter((id) => id > 0))];
  const triggerIds = [...new Set(raw.map((row) => row.triggerId).filter(Boolean))];
  const userIds = [...new Set(raw.map((row) => Number(row.userId)).filter((id) => id > 0))];
  const names = new Map<number, string>();
  const triggers = new Map<string, string>();
  const contacts = new Map<string, string>();

  if (businessIds.length) {
    const { data } = await admin.from("businesses").select("id, slug").in("id", businessIds);
    for (const row of data ?? []) names.set(Number(row.id), String(row.slug ?? row.id));
  }
  if (triggerIds.length) {
    const { data } = await admin.from("template_triggers").select("id, trigger_type").in("id", triggerIds);
    for (const row of data ?? []) triggers.set(String(row.id), String(row.trigger_type ?? ""));
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
    out.push({
      businessId: row.businessId,
      business: names.get(row.businessId) || String(row.businessId),
      trigger,
      contact,
      reason: row.reason,
      at: israelStamp(row.at),
    });
  }
  out.sort((a, b) => a.business.localeCompare(b.business, "he") || a.trigger.localeCompare(b.trigger));
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

  const detail = unsentDetailParam(rows);
  const text = renderAdminDailyUnsentText(rows.length, detail);
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
    console.info("[admin-daily-unsent] held until template is approved", { templateStatus, count: rows.length });
    return { ...empty, count: rows.length, text, templateStatus, reason: "template_not_approved" };
  }
  if (input.dryRun) {
    return { ...empty, count: rows.length, text, templateStatus, reason: "dry_run" };
  }

  const sent = await sendAdminWhatsAppTemplate({
    to: ADMIN_SUPPORT_ALERT_WHATSAPP,
    templateName: ADMIN_DAILY_UNSENT_TEMPLATE,
    languageCode: "he",
    bodyParams: [String(rows.length), detail],
  });
  if (!sent.ok) {
    console.error("[admin-daily-unsent] send failed", sent.error);
    return { ...empty, count: rows.length, text, templateStatus, reason: sent.error || "send_failed" };
  }
  await logMarketingWhatsAppMessage({
    leadPhone: ADMIN_SUPPORT_ALERT_WHATSAPP,
    role: "assistant",
    content: text,
    model_used: ADMIN_DAILY_UNSENT_MODEL,
  });
  console.info("[admin-daily-unsent] sent", { count: rows.length });
  return { ...empty, sent: true, count: rows.length, text, templateStatus, reason: "sent" };
}
