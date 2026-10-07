import { businessHasArboxConnection } from "@/lib/crm/types";

/** One leadsInProcessReport pull per business per minute while the picker is open. */
export const LEAD_STATUS_REFRESH_THROTTLE_MS = 60_000;

export type LeadStatusCatalogRow = { status: string; last_seen_at: string };

export function distinctNonEmptyLeadStatuses(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const status = String(row.lead_status ?? "").trim();
    if (status) seen.add(status);
  }
  return [...seen];
}

/** Distinct lead ids, including rows whose lead_status is blank. */
export function countLeadStatusReportLeads(rows: readonly Record<string, unknown>[]): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const leadId = String(row.user_id ?? row.lead_id ?? "").trim();
    if (leadId) seen.add(leadId);
  }
  return seen.size;
}

export function leadStatusRefreshThrottleHit(input: {
  rows: readonly { last_seen_at?: string | null }[];
  now: Date;
}): boolean {
  let newest = Number.NEGATIVE_INFINITY;
  for (const row of input.rows) {
    const ms = Date.parse(String(row.last_seen_at ?? ""));
    if (Number.isFinite(ms) && ms > newest) newest = ms;
  }
  if (newest === Number.NEGATIVE_INFINITY) return false;
  const age = input.now.getTime() - newest;
  return age >= 0 && age < LEAD_STATUS_REFRESH_THROTTLE_MS;
}

/** A failed refresh keeps the cached list. An empty failure is the only error state. */
export function leadStatusPickerAfterRefresh(input: {
  ok: boolean;
  statuses: readonly LeadStatusCatalogRow[];
}): { statuses: LeadStatusCatalogRow[]; error: string | null } {
  if (input.ok || input.statuses.length > 0) {
    return { statuses: [...input.statuses], error: null };
  }
  return { statuses: [], error: "לא הצלחנו לטעון את הסטטוסים מארבוקס" };
}

export function leadStatusRefreshArboxError(
  row: { crm_type?: unknown; crm_api_key?: unknown; crm_box_id?: unknown } | null | undefined
): "arbox_not_connected" | null {
  if (!businessHasArboxConnection(row)) return "arbox_not_connected";
  if (!String(row?.crm_box_id ?? "").trim()) return "arbox_not_connected";
  return null;
}
