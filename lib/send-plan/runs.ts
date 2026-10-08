/**
 * send_plan_runs: which businesses PLAN covered for a day + slot. DISPATCH sends their planned
 * rows and runs the legacy worker only for the rest, so a missing or failed PLAN means
 * today's behavior for that business. IO: one upsert per PLAN, one indexed read per DISPATCH.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { workerRunIncomplete } from "@/lib/leads/arbox-daily-run-status";
import type { WorkerDispatchResult } from "@/lib/leads/arbox-daily-triggers-dispatch";
import { sendHeldAlert, type HeldCount } from "@/lib/send-plan/alerts";
import { dispatchInstant, PLAN_SLOT_HM, type PlanSlot } from "@/lib/send-plan/checks";
import type { PlanSummary } from "@/lib/send-plan/collector";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const SEND_PLAN_RUNS_TABLE = "send_plan_runs";

/** PLAN this close to DISPATCH (or after it) does nothing; DISPATCH then runs the legacy worker. */
export const PLAN_LATEST_BEFORE_DISPATCH_MS = 5 * 60_000;

export function planTooLate(planDay: string, slot: PlanSlot, now: Date): boolean {
  const at = dispatchInstant(planDay, slot);
  return !at || now.getTime() > at.getTime() - PLAN_LATEST_BEFORE_DISPATCH_MS;
}

function isMissingTable(message: string): boolean {
  return /does not exist|42P01|PGRST205|schema cache/i.test(message);
}

export function planSummaryOf(row: WorkerDispatchResult): PlanSummary | null {
  const plan = (row.body as { plan?: unknown } | null)?.plan;
  return plan && typeof plan === "object" ? (plan as PlanSummary) : null;
}

export async function recordSendPlanRuns(input: {
  admin: Admin;
  planDay: string;
  slot: PlanSlot;
  results: readonly WorkerDispatchResult[];
}): Promise<void> {
  const rows = input.results.map((row) => {
    const reason = workerRunIncomplete(row) ?? (planSummaryOf(row) ? null : "no_plan_summary");
    return {
      plan_day: input.planDay,
      slot: input.slot,
      business_id: row.business_id,
      status: reason ? "incomplete" : "ok",
      reason,
      counts: planSummaryOf(row),
      planned_at: new Date().toISOString(),
    };
  });
  if (!rows.length) return;
  const { error } = await input.admin.from(SEND_PLAN_RUNS_TABLE).upsert(rows, { onConflict: "plan_day,slot,business_id" });
  if (error) {
    console.error(
      isMissingTable(error.message)
        ? "[send-plan] send_plan_runs missing, run supabase/plan_before_send.sql"
        : "[send-plan] plan run write failed:",
      error.message
    );
  }
}

/** Businesses with a PLAN row for this day + slot, by status. */
export async function loadSendPlanRuns(
  admin: Admin,
  planDay: string,
  slot: PlanSlot
): Promise<{ ok: Set<number>; incomplete: Set<number> }> {
  const out = { ok: new Set<number>(), incomplete: new Set<number>() };
  const { data, error } = await admin
    .from(SEND_PLAN_RUNS_TABLE)
    .select("business_id, status")
    .eq("plan_day", planDay)
    .eq("slot", slot);
  if (error) {
    if (!isMissingTable(error.message)) console.error("[send-plan] plan run read failed:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    const id = Number((row as { business_id?: unknown }).business_id);
    if (!Number.isFinite(id)) continue;
    if ((row as { status?: unknown }).status === "ok") out.ok.add(id);
    else out.incomplete.add(id);
  }
  return out;
}

export async function markSendPlanDispatched(admin: Admin, planDay: string, slot: PlanSlot, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await admin
    .from(SEND_PLAN_RUNS_TABLE)
    .update({ dispatched_at: new Date().toISOString() })
    .eq("plan_day", planDay)
    .eq("slot", slot)
    .in("business_id", ids);
  if (error && !isMissingTable(error.message)) console.error("[send-plan] dispatched mark failed:", error.message);
}

/** One Zoe Admin alert after PLAN when anything is held: counts per business and reason. */
export async function alertHeldAfterPlan(input: {
  admin: Admin;
  slot: PlanSlot;
  results: readonly WorkerDispatchResult[];
}): Promise<{ sent: boolean; held: number }> {
  const held: Array<{ businessId: number; reason: string; count: number }> = [];
  for (const row of input.results) {
    const plan = planSummaryOf(row);
    for (const [reason, count] of Object.entries(plan?.held_by_reason ?? {})) {
      if (count > 0) held.push({ businessId: row.business_id, reason, count });
    }
  }
  const total = held.reduce((sum, row) => sum + row.count, 0);
  if (!total) return { sent: false, held: 0 };
  const ids = [...new Set(held.map((row) => row.businessId))];
  const { data } = await input.admin.from("businesses").select("id, name, slug").in("id", ids);
  const names = new Map<number, string>();
  for (const biz of data ?? []) {
    const b = biz as { id?: unknown; name?: unknown; slug?: unknown };
    names.set(Number(b.id), String(b.name ?? "").trim() || String(b.slug ?? "").trim());
  }
  const rows: HeldCount[] = held.map((row) => ({
    business: names.get(row.businessId) || `עסק ${row.businessId}`,
    reason: row.reason,
    count: row.count,
  }));
  const label = input.slot === "morning" ? "בוקר" : "ערב";
  const result = await sendHeldAlert({
    admin: input.admin,
    headline: `תכנון ${label}: לא יוצאות ב-${PLAN_SLOT_HM[input.slot].dispatch} עד שחרור`,
    rows,
  });
  return { sent: result.ok && !result.skipped, held: total };
}
