/**
 * A contact who asked to cancel, freeze, or complained gets no retention template for 14 days.
 * The signal is the closed-playbook category Zoe already sends on that handoff
 * (cancellation / freeze / complaint), stamped on contacts at handoff time.
 * Other handoffs do not block. Operational triggers do not read this.
 * IO: one indexed contacts read per business per run (partial index on leave_request_at).
 */
import { normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const LEAVE_REQUEST_REASON = "leave_request_14d";
export const LEAVE_REQUEST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const LEAVE_REQUEST_KINDS = ["cancellation", "freeze", "complaint"] as const;
export type LeaveRequestKind = (typeof LEAVE_REQUEST_KINDS)[number];

export function isLeaveRequestKind(value: unknown): value is LeaveRequestKind {
  return (LEAVE_REQUEST_KINDS as readonly string[]).includes(String(value ?? ""));
}

function isMissingLeaveColumn(message: string): boolean {
  return /leave_request_(?:at|kind)/i.test(message) && /does not exist|schema cache|42703|PGRST204/i.test(message);
}

/** At handoff time. No-op for other categories. Logged, never thrown. */
export async function stampLeaveRequest(input: {
  admin: Admin;
  businessId: number;
  phoneVariants: string[];
  kind: unknown;
  nowIso: string;
}): Promise<void> {
  if (!isLeaveRequestKind(input.kind) || !input.businessId || !input.phoneVariants.length) return;
  const { error } = await input.admin
    .from("contacts")
    .update({ leave_request_at: input.nowIso, leave_request_kind: input.kind })
    .eq("business_id", input.businessId)
    .in("phone", input.phoneVariants);
  if (error) {
    const log = isMissingLeaveColumn(error.message) ? console.warn : console.error;
    log("[leave-request] stamp failed:", error.message, { businessId: input.businessId, kind: input.kind });
  }
}

export type LeaveRequestContact = {
  id?: string | null;
  phone?: string | null;
  arbox_user_id?: string | number | null;
};

export type LeaveRequestIndex = { has(contact: LeaveRequestContact | null | undefined): boolean };

export function buildLeaveRequestIndex(rows: LeaveRequestContact[]): LeaveRequestIndex {
  const ids = new Set<string>();
  const phones = new Set<string>();
  const users = new Set<string>();
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (id) ids.add(id);
    const phone = normalizePhone(String(row.phone ?? ""));
    if (phone) phones.add(phone);
    const user = Number(row.arbox_user_id);
    if (Number.isFinite(user) && user > 0) users.add(String(user));
  }
  return {
    has(contact) {
      if (!contact) return false;
      const id = String(contact.id ?? "").trim();
      if (id && ids.has(id)) return true;
      const phone = normalizePhone(String(contact.phone ?? ""));
      if (phone && phones.has(phone)) return true;
      const user = Number(contact.arbox_user_id);
      return Number.isFinite(user) && user > 0 && users.has(String(user));
    },
  };
}

const EMPTY_INDEX = buildLeaveRequestIndex([]);

/**
 * One lazy load per trigger run.
 * error: the read failed. The caller leaves the event unwritten so the next run decides it.
 */
export function createLeaveRequestGate(admin: Admin, businessId: number, now: Date) {
  let loaded: Promise<{ ok: true; index: LeaveRequestIndex } | { ok: false; error: string }> | null = null;
  return async (contact: LeaveRequestContact | null | undefined): Promise<"blocked" | "clear" | "error"> => {
    loaded ??= loadLeaveRequests(admin, businessId, now);
    const result = await loaded;
    if (!result.ok) return "error";
    return result.index.has(contact) ? "blocked" : "clear";
  };
}

/**
 * Contacts with a leave request in the last 14 days.
 * Before contacts_leave_request.sql runs nobody is stamped, so a missing column is an empty index.
 */
export async function loadLeaveRequests(
  admin: Admin,
  businessId: number,
  now: Date
): Promise<{ ok: true; index: LeaveRequestIndex } | { ok: false; error: string }> {
  const since = new Date(now.getTime() - LEAVE_REQUEST_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from("contacts")
    .select("id, phone, arbox_user_id")
    .eq("business_id", businessId)
    .gte("leave_request_at", since)
    .limit(2000);
  if (error) {
    if (isMissingLeaveColumn(error.message)) return { ok: true, index: EMPTY_INDEX };
    console.error("[leave-request] load failed:", error.message, { businessId });
    return { ok: false, error: error.message };
  }
  return { ok: true, index: buildLeaveRequestIndex((data ?? []) as LeaveRequestContact[]) };
}
