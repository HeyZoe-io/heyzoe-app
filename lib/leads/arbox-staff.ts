/**
 * Staff roster: one GET /v3/users/allStaffMembers per business on the morning run.
 * user_id + phone. Active and inactive are both staff: some current coaches are active=0.
 * A failed or page-capped fetch does not clear contacts.arbox_is_staff.
 * Until that column exists, the in-run roster still excludes staff and the flag write is skipped.
 *
 * IO: 1 GET per business per morning (a second page only if the first returns 500).
 * At 10x studios that is about 10 calls a day. No Claude, no WhatsApp.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { arboxDailyContext } from "@/lib/leads/arbox-daily-run-context";
import { contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

const PAGE_LIMIT = 500;
const MAX_PAGES = 3;
const PHONE_CHUNK = 80;
const ID_CHUNK = 200;

export const RETENTION_STAFF_TRIGGERS = [
  "attendance_gap",
  "missed_class",
  "missed_trial",
  "lost_lead",
  "lead_status_changed",
  "no_response",
  "milestones",
  "nth_workout",
  "birthday",
  "birthday_former",
  "membership_expiring",
  "sessions_expiring",
  "membership_cancelled",
  "freeze_created",
  "freeze_ending_booked",
  "freeze_ending_unbooked",
] as const;

export const OPERATIONAL_KEEPS_STAFF = [
  "class_cancelled_customer",
  "class_cancelled_staff",
  "trial_reminder",
  "trial_booked",
  "trainer_trial_heads_up",
  "purchase",
  "first_paid_purchase",
] as const;

export type StaffPerson = {
  userId: number;
  phone: string | null;
  name: string;
  active: boolean;
};

export type StaffIndex = {
  ready: boolean;
  userIds: Set<number>;
  phones: Set<string>;
  people: StaffPerson[];
};

export type StaffFlagSummary = {
  staff_phones: number;
  marked_true: number;
  marked_false: number;
  skipped?: string;
};

function emptyIndex(): StaffIndex {
  return { ready: false, userIds: new Set(), phones: new Set(), people: [] };
}

export function triggerSkipsStaff(triggerType: string): boolean {
  return (RETENTION_STAFF_TRIGGERS as readonly string[]).includes(triggerType);
}

export function parseStaffMembers(rows: readonly Record<string, unknown>[]): StaffPerson[] {
  const people: StaffPerson[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const userId = Number(row.user_id);
    if (!Number.isFinite(userId) || userId <= 0 || seen.has(userId)) continue;
    seen.add(userId);
    const name = [row.first_name, row.last_name]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    people.push({
      userId,
      phone: normalizePhone(row.phone),
      name,
      active: String(row.active ?? "") === "1",
    });
  }
  return people;
}

export function staffIndexFromPeople(people: readonly StaffPerson[], ready: boolean): StaffIndex {
  const userIds = new Set<number>();
  const phones = new Set<string>();
  for (const person of people) {
    userIds.add(person.userId);
    if (person.phone) phones.add(person.phone);
  }
  return { ready, userIds, phones, people: [...people] };
}

function phoneMatches(phone: string, phones: Set<string>): boolean {
  for (const variant of contactPhoneLookupVariants(phone)) {
    const normalized = normalizePhone(variant);
    if (normalized && phones.has(normalized)) return true;
  }
  return false;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function missingStaffColumn(message: string): boolean {
  return /arbox_is_staff|arbox_staff_synced_at|schema cache|does not exist/i.test(message);
}

export function isRetentionStaff(
  index: StaffIndex | null | undefined,
  input: { userId?: number | null; phone?: string | null }
): boolean {
  if (!index?.ready) return false;
  if (input.userId != null && input.userId > 0 && index.userIds.has(input.userId)) return true;
  const phone = normalizePhone(input.phone);
  if (phone && phoneMatches(phone, index.phones)) return true;
  return false;
}

export async function fetchArboxStaffMembers(input: {
  apiKey: string;
  boxId: string;
  fetchPage?: typeof arboxPublicFetch;
}): Promise<{ ok: true; people: StaffPerson[]; pages: number } | { ok: false; error: string; pages: number }> {
  const fetchPage = input.fetchPage ?? arboxPublicFetch;
  const rows: Record<string, unknown>[] = [];
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const path =
      `/v3/users/allStaffMembers?location_id=${encodeURIComponent(input.boxId)}` +
      `&limit=${PAGE_LIMIT}&page=${page}`;
    const res = await fetchPage(path, { apiKey: input.apiKey, method: "GET", timeoutMs: 20000 });
    pages += 1;
    if (!res.ok) return { ok: false, error: `http_${res.status}`, pages };
    const data = (res.json as { data?: unknown })?.data;
    const batch = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    rows.push(...batch);
    if (batch.length < PAGE_LIMIT) {
      return { ok: true, people: parseStaffMembers(rows), pages };
    }
  }
  return { ok: false, error: "page_cap", pages };
}

export async function syncArboxStaffFlags(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  people: readonly StaffPerson[];
  /** False keeps yesterday's flags. */
  reportComplete: boolean;
  now?: Date;
}): Promise<StaffFlagSummary> {
  const phones = new Set(input.people.map((person) => person.phone).filter((phone): phone is string => Boolean(phone)));
  if (!input.reportComplete) {
    return { staff_phones: phones.size, marked_true: 0, marked_false: 0, skipped: "report_incomplete" };
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  const variants = [...new Set([...phones].flatMap((phone) => contactPhoneLookupVariants(phone)))];
  let markedTrue = 0;
  for (const part of chunk(variants, PHONE_CHUNK)) {
    if (!part.length) continue;
    const { data, error } = await input.admin
      .from("contacts")
      .update({ arbox_is_staff: true, arbox_staff_synced_at: nowIso })
      .eq("business_id", input.businessId)
      .eq("arbox_is_staff", false)
      .in("phone", part)
      .select("id");
    if (error) {
      if (missingStaffColumn(error.message)) {
        console.error("[arbox-staff] column missing — run supabase/contacts_arbox_is_staff_and_sync_log_reason.sql", {
          businessId: input.businessId,
        });
        return { staff_phones: phones.size, marked_true: 0, marked_false: 0, skipped: "column_missing" };
      }
      console.error("[arbox-staff] mark true failed:", error.message, { businessId: input.businessId });
      return { staff_phones: phones.size, marked_true: markedTrue, marked_false: 0, skipped: "update_failed" };
    }
    markedTrue += data?.length ?? 0;
  }

  const currentlyTrue: { id: string; phone: string }[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await input.admin
      .from("contacts")
      .select("id, phone")
      .eq("business_id", input.businessId)
      .eq("arbox_is_staff", true)
      .range(from, from + 499);
    if (error) {
      if (missingStaffColumn(error.message)) {
        return { staff_phones: phones.size, marked_true: markedTrue, marked_false: 0, skipped: "column_missing" };
      }
      console.error("[arbox-staff] list staff failed:", error.message, { businessId: input.businessId });
      break;
    }
    for (const row of data ?? []) {
      currentlyTrue.push({
        id: String((row as { id: unknown }).id),
        phone: String((row as { phone?: unknown }).phone ?? ""),
      });
    }
    if (!data || data.length < 500) break;
  }

  const clearIds = currentlyTrue.filter((row) => !phoneMatches(row.phone, phones)).map((row) => row.id);
  let markedFalse = 0;
  for (const ids of chunk(clearIds, ID_CHUNK)) {
    const { data, error } = await input.admin
      .from("contacts")
      .update({ arbox_is_staff: false, arbox_staff_synced_at: nowIso })
      .eq("business_id", input.businessId)
      .eq("arbox_is_staff", true)
      .in("id", ids)
      .select("id");
    if (error) {
      console.error("[arbox-staff] mark false failed:", error.message, { businessId: input.businessId });
      break;
    }
    markedFalse += data?.length ?? 0;
  }
  return { staff_phones: phones.size, marked_true: markedTrue, marked_false: markedFalse };
}

export async function loadStoredStaffIndex(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<StaffIndex> {
  const phones = new Set<string>();
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("contacts")
      .select("phone")
      .eq("business_id", businessId)
      .eq("arbox_is_staff", true)
      .range(from, from + 499);
    if (error) {
      if (missingStaffColumn(error.message)) return emptyIndex();
      console.error("[arbox-staff] stored flags read failed:", error.message, { businessId });
      return emptyIndex();
    }
    for (const row of data ?? []) {
      const phone = normalizePhone((row as { phone?: unknown }).phone);
      if (phone) phones.add(phone);
    }
    if (!data || data.length < 500) break;
  }
  return { ready: true, userIds: new Set(), phones, people: [] };
}

export async function retentionStaffIndex(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<StaffIndex> {
  const ctx = arboxDailyContext();
  if (ctx?.staffIndex && ctx.businessId === businessId) return ctx.staffIndex;
  return loadStoredStaffIndex(admin, businessId);
}
