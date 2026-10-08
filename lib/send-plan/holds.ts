/**
 * Admin actions on held rows (app/admin/held-sends). Release: a PLAN / event row goes back to
 * planned (DISPATCH sends it, or now when DISPATCH already passed and it is still relevant);
 * a Stage C queue row goes back to pending. Cancel: canceled_by_admin. Unreleased holds are
 * canceled after their day (cancelExpiredHolds).
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { claimQueuedTemplateSend } from "@/lib/leads/sync-log-claim";
import { planDayOf } from "@/lib/send-plan/checks";
import {
  isStoredComponentsRow,
  PLANNED_ROW_SELECT,
  releasedRowSendableNow,
  sendPlannedRow,
  type DispatchDeps,
  type PlannedRow,
} from "@/lib/send-plan/dispatch";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const ADMIN_CANCELED_REASON = "canceled_by_admin";
export const RELEASE_NOT_RELEVANT_REASON = "release_not_relevant";
export const HELD_LIST_LIMIT = 500;

export type HeldRow = {
  id: string;
  business_id: number;
  business: string;
  trigger_id: string | null;
  contact_phone: string;
  template_name: string;
  due_at: string;
  plan_day: string | null;
  plan_slot: string | null;
  hold_reason: string | null;
  last_error: string | null;
  rendered_body: string | null;
};

export type HeldSelector = { ids?: string[]; group?: { businessId: number; reason: string } };

export type TriggerPause = {
  business_id: number;
  business: string;
  trigger_key: string;
  paused_at: string;
  paused_until: string | null;
  reason: string | null;
  sent_last_hour: number | null;
  hourly_baseline: number | null;
};

async function businessNames(admin: Admin, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const { data } = await admin.from("businesses").select("id, name, slug").in("id", ids);
  for (const row of data ?? []) {
    const b = row as { id?: unknown; name?: unknown; slug?: unknown };
    out.set(Number(b.id), String(b.name ?? "").trim() || String(b.slug ?? ""));
  }
  return out;
}

/** Held rows, newest day first. Partial index on status = held. */
export async function loadHeldRows(admin: Admin): Promise<{ rows: HeldRow[]; error?: string }> {
  const { data, error } = await admin
    .from("scheduled_template_sends")
    .select(
      "id, business_id, trigger_id, contact_phone, template_name, due_at, plan_day, plan_slot, hold_reason, last_error, rendered_body"
    )
    .eq("status", "held")
    .order("plan_day", { ascending: false })
    .order("business_id", { ascending: true })
    .limit(HELD_LIST_LIMIT);
  if (error) return { rows: [], error: error.message };
  const raw = (data ?? []) as Array<Omit<HeldRow, "business">>;
  const names = await businessNames(admin, [...new Set(raw.map((row) => Number(row.business_id)))]);
  return {
    rows: raw.map((row) => ({ ...row, business: names.get(Number(row.business_id)) || `עסק ${row.business_id}` })),
  };
}

export async function loadActivePauses(admin: Admin, now: Date): Promise<TriggerPause[]> {
  const { data, error } = await admin
    .from("send_trigger_pauses")
    .select("business_id, trigger_key, paused_at, paused_until, reason, sent_last_hour, hourly_baseline")
    .is("resumed_at", null)
    .gt("paused_until", now.toISOString())
    .limit(200);
  if (error) return [];
  const raw = (data ?? []) as Array<Omit<TriggerPause, "business">>;
  const names = await businessNames(admin, [...new Set(raw.map((row) => Number(row.business_id)))]);
  return raw.map((row) => ({ ...row, business: names.get(Number(row.business_id)) || `עסק ${row.business_id}` }));
}

async function selectHeld(admin: Admin, selector: HeldSelector): Promise<PlannedRow[]> {
  const ids = (selector.ids ?? []).filter((id) => typeof id === "string" && id.trim()).slice(0, HELD_LIST_LIMIT);
  if (!ids.length && !selector.group) return [];
  let query = admin.from("scheduled_template_sends").select(PLANNED_ROW_SELECT).eq("status", "held");
  if (ids.length) query = query.in("id", ids);
  if (selector.group) {
    query = query.eq("business_id", selector.group.businessId).eq("hold_reason", selector.group.reason);
  }
  const { data, error } = await query.limit(HELD_LIST_LIMIT);
  if (error) {
    console.error("[send-plan] held select failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as PlannedRow[];
}

export type HeldActionResult = { matched: number; released?: number; sent_now?: number; canceled: number; failed: number };

export async function cancelHeld(admin: Admin, selector: HeldSelector, by: string): Promise<HeldActionResult> {
  const rows = await selectHeld(admin, selector);
  if (!rows.length) return { matched: 0, canceled: 0, failed: 0 };
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("scheduled_template_sends")
    .update({ status: "canceled", last_error: ADMIN_CANCELED_REASON, released_by: by, updated_at: now })
    .in(
      "id",
      rows.map((row) => row.id)
    )
    .eq("status", "held")
    .select("id");
  if (error) {
    console.error("[send-plan] held cancel failed:", error.message);
    return { matched: rows.length, canceled: 0, failed: rows.length };
  }
  console.info("[send-plan] held canceled by admin", { by, count: data?.length ?? 0 });
  return { matched: rows.length, canceled: data?.length ?? 0, failed: 0 };
}

export async function releaseHeld(
  admin: Admin,
  selector: HeldSelector,
  by: string,
  now = new Date(),
  deps?: DispatchDeps
): Promise<HeldActionResult> {
  const rows = await selectHeld(admin, selector);
  const result: HeldActionResult = { matched: rows.length, released: 0, sent_now: 0, canceled: 0, failed: 0 };
  for (const row of rows) {
    const stored = isStoredComponentsRow(row);
    const dueNow = Date.parse(row.due_at) <= now.getTime();
    if (stored && dueNow && !releasedRowSendableNow(row, now)) {
      const { error } = await admin
        .from("scheduled_template_sends")
        .update({ status: "canceled", last_error: RELEASE_NOT_RELEVANT_REASON, released_at: now.toISOString(), released_by: by, updated_at: now.toISOString() })
        .eq("id", row.id)
        .eq("status", "held");
      if (error) result.failed += 1;
      else result.canceled += 1;
      continue;
    }
    const { data, error } = await admin
      .from("scheduled_template_sends")
      .update({
        status: stored ? "planned" : "pending",
        last_error: null,
        released_at: now.toISOString(),
        released_by: by,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "held")
      .select("id");
    if (error || !data?.length) {
      result.failed += 1;
      continue;
    }
    result.released! += 1;
    if (!stored || !dueNow) continue;
    // DISPATCH for this row already passed (or it is an event row): send now through the claim.
    const claim = await claimQueuedTemplateSend(admin, row.dedup_key, "planned");
    if (claim !== "won") continue;
    const sent = await sendPlannedRow(admin, row, now, { deps }).catch((e) => {
      console.error("[send-plan] release send threw:", e instanceof Error ? e.message : e, { id: row.id });
      return { outcome: "unknown" as const };
    });
    if (sent.outcome === "sent") result.sent_now! += 1;
  }
  console.info("[send-plan] held released by admin", { by, ...result, plan_day: planDayOf(now) });
  return result;
}

export async function resumeTriggerPause(
  admin: Admin,
  businessId: number,
  triggerKey: string,
  by: string,
  now: Date = new Date()
): Promise<boolean> {
  const { error } = await admin
    .from("send_trigger_pauses")
    .update({ resumed_at: now.toISOString(), resumed_by: by })
    .eq("business_id", businessId)
    .eq("trigger_key", triggerKey);
  if (error) console.error("[send-plan] pause resume failed:", error.message, { businessId, triggerKey });
  return !error;
}
