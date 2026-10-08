/**
 * DISPATCH (09:00 / 20:00): sends only the rows PLAN wrote as planned, each claimed
 * planned → sending first (the shared queue claim), then re-validated from the database:
 * still not sent (the 20h claim in sendBusinessTemplate), not opted out, no leave request,
 * the booking still active in arbox_future_booking_snapshot, the class not started,
 * the business not paused. No Arbox and no Claude calls.
 * The components sent are exactly the ones PLAN rendered and checked.
 *
 * A Meta error goes back to pending; the Stage C drain retries it with the same stored
 * components (sendPlannedRow) up to SCHEDULED_SEND_ATTEMPT_CAP.
 * IO per row: one claim update, one contact read, one snapshot read (class-bound only),
 * one settle update. Business rows are read once per dispatch.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage } from "@/lib/analytics";
import { sendBusinessTemplate, type OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import { DUPLICATE_GUARD_ERROR } from "@/lib/notifications/template-duplicate-guard";
import { claimQueuedTemplateSend } from "@/lib/leads/sync-log-claim";
import {
  decideScheduledSendAfterMeta,
  nextScheduledSendAfterMetaError,
} from "@/lib/scheduled-template-sends";
import { arboxBackgroundPauseSelect, ARBOX_BACKGROUND_PAUSED, rowArboxBackgroundPaused } from "@/lib/arbox-background-pause";
import { LEAD_TEMPLATE_MODEL } from "@/lib/lead-template";
import { buildWaSessionId } from "@/lib/phone-normalize";
import { isAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import { LEAVE_REQUEST_TRIGGERS, planDayOf, SKIP_REASONS, type PlanSlot } from "@/lib/send-plan/checks";
import { loadContactCheck } from "@/lib/send-plan/data";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Triggers about a class that has not happened yet: once it starts, the message is stale. */
const FUTURE_CLASS_TRIGGERS = new Set(["trial_reminder", "trainer_trial_heads_up"]);

export const PLANNED_ROW_SELECT =
  "id, business_id, trigger_id, contact_phone, template_name, due_at, status, dedup_key, last_error, attempts, plan_day, plan_slot, phone_number_id, language_code, components, recipient_kind, rendered_body, event_key, event_at, event_meta, hold_reason, log_message";

export type PlannedRow = {
  id: string;
  business_id: number;
  trigger_id: string | null;
  contact_phone: string;
  template_name: string;
  due_at: string;
  status: string;
  dedup_key: string;
  last_error: string | null;
  attempts?: number | null;
  plan_day: string | null;
  plan_slot: string | null;
  phone_number_id: string | null;
  language_code: string | null;
  components: OwnerTemplateComponent[] | null;
  recipient_kind: string | null;
  rendered_body: string | null;
  event_key: string | null;
  event_at: string | null;
  event_meta: { eventDedupKey?: string | null; triggerType?: string | null; userId?: number; ymd?: string; time?: string } | null;
  hold_reason: string | null;
  log_message: { business_slug?: string; role?: string; content?: string; model_used?: string | null; session_id?: string | null } | null;
};

/** A row PLAN or the event gate wrote, sendable from its stored components. */
export function isStoredComponentsRow(row: { dedup_key?: string | null; components?: unknown }): boolean {
  return String(row.dedup_key ?? "").startsWith("plan:") && row.components != null;
}

export type DispatchOutcome = "sent" | "failed" | "canceled" | "skipped" | "blocked" | "unknown" | "held" | "lost";

export type RevalidationInput = {
  row: Pick<PlannedRow, "recipient_kind" | "event_at" | "event_meta">;
  now: Date;
  businessPaused: boolean;
  contact: { optedOut: boolean; leaveRequest: boolean } | null;
  bookingActive: boolean | null;
};

/** Pure: why a planned row must not go out now, or null. */
export function revalidatePlannedRow(input: RevalidationInput): { status: "canceled" | "skipped"; reason: string } | null {
  if (input.businessPaused) return { status: "canceled", reason: ARBOX_BACKGROUND_PAUSED };
  const type = String(input.row.event_meta?.triggerType ?? "");
  if (input.row.recipient_kind !== "staff") {
    if (input.contact?.optedOut) return { status: "skipped", reason: SKIP_REASONS.optedOut };
    if (input.contact?.leaveRequest && LEAVE_REQUEST_TRIGGERS.includes(type)) {
      return { status: "skipped", reason: SKIP_REASONS.leaveRequest };
    }
  }
  if (FUTURE_CLASS_TRIGGERS.has(type)) {
    const at = input.row.event_at ? Date.parse(input.row.event_at) : NaN;
    if (Number.isFinite(at) && at <= input.now.getTime()) return { status: "skipped", reason: "class_started" };
    if (input.bookingActive === false) return { status: "skipped", reason: "booking_canceled" };
  }
  return null;
}

/** true / false from the snapshot; null when the snapshot has no row for this booking. */
export async function bookingActiveInSnapshot(
  admin: Admin,
  businessId: number,
  meta: PlannedRow["event_meta"]
): Promise<boolean | null> {
  const userId = Number(meta?.userId);
  const ymd = String(meta?.ymd ?? "");
  const time = String(meta?.time ?? "");
  if (!Number.isFinite(userId) || userId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  let query = admin
    .from("arbox_future_booking_snapshot")
    .select("disappeared_at, class_cancelled_at")
    .eq("business_id", businessId)
    .eq("user_id", String(Math.trunc(userId)))
    .eq("class_date", ymd);
  if (/^\d{2}:\d{2}$/.test(time)) query = query.like("class_time", `${time}%`);
  const { data, error } = await query.limit(5);
  if (error) {
    if (!/does not exist|PGRST205|schema cache/i.test(error.message)) {
      console.error("[send-plan] snapshot read failed:", error.message, { businessId });
    }
    return null;
  }
  if (!data?.length) return null;
  return data.some((row) => {
    const r = row as { disappeared_at?: string | null; class_cancelled_at?: string | null };
    return !r.disappeared_at && !r.class_cancelled_at;
  });
}

async function markRow(admin: Admin, id: string, patch: Record<string, unknown>, from: string[]): Promise<void> {
  const update = (body: Record<string, unknown>) =>
    admin
      .from("scheduled_template_sends")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", from);
  let { error } = await update(patch);
  if (error && patch.status === "unknown" && /check constraint|23514/i.test(error.message)) {
    ({ error } = await update({ ...patch, status: "failed" }));
  }
  if (error) console.error("[send-plan] row update failed:", error.message, { id, status: patch.status });
}

const businessPauseCache = new Map<number, { paused: boolean; slug: string; at: number }>();

async function businessState(admin: Admin, businessId: number): Promise<{ paused: boolean; slug: string }> {
  const hit = businessPauseCache.get(businessId);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const { data } = await admin
    .from("businesses")
    .select(`slug, ${await arboxBackgroundPauseSelect(admin)}`)
    .eq("id", businessId)
    .maybeSingle();
  const state = {
    paused: rowArboxBackgroundPaused(data),
    slug: String((data as { slug?: unknown } | null)?.slug ?? "").trim().toLowerCase(),
    at: Date.now(),
  };
  businessPauseCache.set(businessId, state);
  return state;
}

/**
 * Re-validate and send one stored-components row. The caller already holds it at `sending`.
 * dryRun: decide only, nothing is sent or written.
 */
export async function sendPlannedRow(
  admin: Admin,
  row: PlannedRow,
  now: Date,
  opts: { dryRun?: boolean } = {}
): Promise<{ outcome: DispatchOutcome; reason?: string }> {
  const business = await businessState(admin, row.business_id);
  const staff = row.recipient_kind === "staff";
  const contact = staff ? null : await loadContactCheck(admin, row.business_id, row.contact_phone, now);
  const type = String(row.event_meta?.triggerType ?? "");
  const bookingActive = FUTURE_CLASS_TRIGGERS.has(type)
    ? await bookingActiveInSnapshot(admin, row.business_id, row.event_meta)
    : null;
  const stop = revalidatePlannedRow({ row, now, businessPaused: business.paused, contact, bookingActive });
  if (stop) {
    if (!opts.dryRun) {
      await markRow(admin, row.id, { status: stop.status, last_error: stop.reason, hold_reason: stop.reason }, ["sending"]);
    }
    return { outcome: stop.status, reason: stop.reason };
  }
  if (!row.phone_number_id) {
    if (!opts.dryRun) await markRow(admin, row.id, { status: "canceled", last_error: "no_channel" }, ["sending"]);
    return { outcome: "canceled", reason: "no_channel" };
  }
  if (opts.dryRun) return { outcome: "sent" };

  const result = await sendBusinessTemplate({
    to: row.contact_phone,
    phoneNumberId: row.phone_number_id,
    templateName: row.template_name,
    languageCode: row.language_code || "he",
    alertTriggerId: row.trigger_id,
    eventDedupKey: row.event_meta?.eventDedupKey ?? null,
    skipOptOutGate: true,
    skipSendChecks: true,
    ...(staff ? { recipientKind: "staff" as const } : {}),
    ...(row.components?.length ? { components: row.components } : {}),
  });

  if (!result.ok && result.error === DUPLICATE_GUARD_ERROR) {
    await markRow(admin, row.id, { status: "blocked", last_error: "duplicate", hold_reason: "duplicate" }, ["sending"]);
    return { outcome: "blocked", reason: "duplicate" };
  }
  const after = decideScheduledSendAfterMeta({ ok: result.ok, error: result.error });
  if (after.status === "held") {
    await markRow(admin, row.id, { status: "pending", last_error: after.last_error }, ["sending"]);
    return { outcome: "held", reason: after.last_error };
  }
  if (after.status === "unknown") {
    await markRow(admin, row.id, { status: "unknown", last_error: after.last_error }, ["sending"]);
    return { outcome: "unknown", reason: after.last_error };
  }
  if (after.status === "failed") {
    const next = nextScheduledSendAfterMetaError(Number(row.attempts ?? 0));
    await markRow(admin, row.id, { status: next.status, last_error: after.last_error, attempts: next.attempts }, ["sending"]);
    return { outcome: "failed", reason: after.last_error };
  }
  if (after.status === "canceled") {
    await markRow(admin, row.id, { status: "canceled", last_error: after.last_error }, ["sending"]);
    return { outcome: "canceled", reason: after.last_error };
  }
  await markRow(admin, row.id, { status: "sent", last_error: null }, ["sending"]);
  if (!staff) await logPlannedSend(row, business.slug);
  return { outcome: "sent" };
}

async function logPlannedSend(row: PlannedRow, slug: string): Promise<void> {
  const captured = row.log_message;
  const sessionId = captured?.session_id || buildWaSessionId(row.phone_number_id, row.contact_phone);
  const businessSlug = captured?.business_slug || slug;
  const content = captured?.content || row.rendered_body || "";
  if (!businessSlug || !sessionId || !content) return;
  await logMessage({
    business_slug: businessSlug,
    role: "assistant",
    content,
    model_used: captured?.model_used ?? LEAD_TEMPLATE_MODEL,
    session_id: sessionId,
  }).catch((e) => console.error("[send-plan] conversation log failed:", e instanceof Error ? e.message : e));
}

export type DispatchSummary = {
  plan_day: string;
  slot: PlanSlot;
  dry_run: boolean;
  fetched: number;
  outcomes: Record<string, number>;
  would_send?: Array<{ business_id: number; template: string; phone_tail: string; outcome: string; reason?: string }>;
};

/** Every planned row of this day + slot that is due. Index (plan_day, plan_slot, status). */
export async function dispatchPlannedSends(input: {
  admin: Admin;
  slot: PlanSlot;
  now: Date;
  dryRun?: boolean;
  limit?: number;
}): Promise<DispatchSummary> {
  const planDay = planDayOf(input.now);
  const summary: DispatchSummary = {
    plan_day: planDay,
    slot: input.slot,
    dry_run: input.dryRun === true,
    fetched: 0,
    outcomes: {},
    ...(input.dryRun ? { would_send: [] } : {}),
  };
  const { data, error } = await input.admin
    .from("scheduled_template_sends")
    .select(PLANNED_ROW_SELECT)
    .eq("plan_day", planDay)
    .eq("plan_slot", input.slot)
    .eq("status", "planned")
    .lte("due_at", input.now.toISOString())
    .order("due_at", { ascending: true })
    .limit(input.limit ?? 1000);
  if (error) {
    console.error("[send-plan] dispatch select failed:", error.message, { planDay, slot: input.slot });
    summary.outcomes.select_error = 1;
    return summary;
  }
  const rows = (data ?? []) as unknown as PlannedRow[];
  summary.fetched = rows.length;
  for (const row of rows) {
    let outcome: DispatchOutcome;
    let reason: string | undefined;
    if (input.dryRun) {
      ({ outcome, reason } = await sendPlannedRow(input.admin, row, input.now, { dryRun: true }));
      summary.would_send!.push({
        business_id: row.business_id,
        template: row.template_name,
        phone_tail: String(row.contact_phone).slice(-4),
        outcome,
        ...(reason ? { reason } : {}),
      });
    } else {
      const claim = await claimQueuedTemplateSend(input.admin, row.dedup_key, "planned");
      if (claim !== "won") {
        outcome = "lost";
      } else {
        try {
          ({ outcome } = await sendPlannedRow(input.admin, row, input.now));
        } catch (e) {
          outcome = "unknown";
          console.error("[send-plan] dispatch row threw:", e instanceof Error ? e.message : e, { id: row.id });
          await markRow(input.admin, row.id, { status: "unknown", last_error: "dispatch_threw" }, ["sending"]);
        }
      }
    }
    summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
  }
  console.info("[send-plan] dispatch done", { plan_day: planDay, slot: input.slot, dry_run: input.dryRun === true, ...summary.outcomes });
  return summary;
}

/** End of day: held rows of an earlier day that nobody released are canceled. Indexed (partial on held). */
export async function cancelExpiredHolds(admin: Admin, now: Date): Promise<number> {
  const { data, error } = await admin
    .from("scheduled_template_sends")
    .update({ status: "canceled", last_error: "hold_expired", updated_at: now.toISOString() })
    .eq("status", "held")
    .lt("plan_day", planDayOf(now))
    .select("id");
  if (error) {
    if (!/plan_day|column/i.test(error.message)) console.error("[send-plan] hold expiry failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/** A released row whose DISPATCH already passed goes out now only while it is still worth sending. */
export function releasedRowSendableNow(row: Pick<PlannedRow, "event_at" | "event_meta" | "plan_day">, now: Date): boolean {
  if (!isAllowedWhatsAppSendTimeIsrael(now)) return false;
  if (row.plan_day && row.plan_day !== planDayOf(now)) return false;
  const type = String(row.event_meta?.triggerType ?? "");
  if (FUTURE_CLASS_TRIGGERS.has(type) && row.event_at && Date.parse(row.event_at) <= now.getTime()) return false;
  return true;
}
