/**
 * Staff roster: one GET /v3/users/allStaffMembers per business on the morning run.
 * A person counts as staff when active=1, or when active=0 and they taught a class
 * in the last 30 days, or when they are assigned to a class in the next 14 days.
 * Past and upcoming teaching come from the bookingsReport rows the morning run
 * already fetches, plus arbox_class_trainer_snapshot when it has rows.
 * Trainer id wins; otherwise the trainer name is matched only inside this
 * business's staff list. No extra Arbox call.
 * A failed staff fetch, or a failed bookings read, does not clear contacts.arbox_is_staff.
 *
 * IO: the staff GET the morning already makes, plus the past and future bookings
 * GETs it already makes, plus two indexed snapshot reads. No Claude, no WhatsApp.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

const PAGE_LIMIT = 500;
const MAX_PAGES = 3;
const PHONE_CHUNK = 80;
const ID_CHUNK = 200;
const TAUGHT_LOOKBACK_DAYS = 30;
/** Matches the future bookings window the morning run already fetches (today…+14). */
const UPCOMING_DAYS = 14;
const TRAINER_SNAPSHOT_TABLE = "arbox_class_trainer_snapshot";
const ISRAEL_TZ = "Asia/Jerusalem";

export type TaughtSighting = {
  userId: number | null;
  phone: string | null;
  name?: string | null;
};

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

export function staffTaughtBounds(now: Date): { todayYmd: string; nowMinutes: number; fromYmd: string } {
  const todayYmd = israelYmd(now);
  return { todayYmd, nowMinutes: israelMinutes(now), fromYmd: addDaysYmd(todayYmd, -TAUGHT_LOOKBACK_DAYS) };
}

export function staffUpcomingBounds(now: Date): { todayYmd: string; nowMinutes: number; toYmd: string } {
  const todayYmd = israelYmd(now);
  return { todayYmd, nowMinutes: israelMinutes(now), toYmd: addDaysYmd(todayYmd, UPCOMING_DAYS) };
}

function israelYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function israelMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ISRAEL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const hour = Number(get("hour"));
  return (hour === 24 ? 0 : hour) * 60 + Number(get("minute"));
}

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function classTimeMinutes(classTime: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(classTime ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** A class counts as taught only after it has started, inside the lookback. */
export function isTaughtInWindow(input: {
  classDate: string;
  classTime?: string | null;
  todayYmd: string;
  nowMinutes: number;
  fromYmd: string;
}): boolean {
  const classDate = String(input.classDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(classDate)) return false;
  if (classDate < input.fromYmd || classDate > input.todayYmd) return false;
  if (classDate < input.todayYmd) return true;
  const minutes = classTimeMinutes(input.classTime ?? null);
  return minutes != null && minutes <= input.nowMinutes;
}

/** Assigned, not yet started, through the forward window the run already fetched. */
export function isUpcomingInWindow(input: {
  classDate: string;
  classTime?: string | null;
  todayYmd: string;
  nowMinutes: number;
  toYmd: string;
}): boolean {
  const classDate = String(input.classDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(classDate)) return false;
  if (classDate < input.todayYmd || classDate > input.toYmd) return false;
  if (classDate > input.todayYmd) return true;
  const minutes = classTimeMinutes(input.classTime ?? null);
  return minutes != null && minutes > input.nowMinutes;
}

/** Trim, collapse spaces, ignore case and diacritics. */
export function normalizeStaffName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * active=1, or inactive and present in the taught set.
 * An id matches that staff user. A name matches only people on this roster.
 * Callers pass taught sightings and upcoming assignments already in window.
 */
export function qualifyingStaffPeople(
  roster: readonly StaffPerson[],
  teachers: readonly TaughtSighting[]
): StaffPerson[] {
  const ids = new Set<number>();
  const phones = new Set<string>();
  const names = new Set<string>();
  for (const teacher of teachers) {
    if (teacher.userId != null && teacher.userId > 0) ids.add(teacher.userId);
    const phone = normalizePhone(teacher.phone);
    if (phone) phones.add(phone);
    const name = normalizeStaffName(teacher.name);
    if (name) names.add(name);
  }
  return roster.filter((person) => {
    if (person.active) return true;
    if (ids.has(person.userId)) return true;
    const name = normalizeStaffName(person.name);
    if (name && names.has(name)) return true;
    return Boolean(person.phone && phoneMatches(person.phone, phones));
  });
}

export type BookingTrainerMatch = {
  /** Trainer keys that had a value, e.g. staff_member / staff_member_id. */
  fields: string[];
  hasId: boolean;
  byId: number;
  byName: number;
  unmatched: string[];
};

function positiveId(raw: unknown): number | null {
  const userId = Number(String(raw ?? "").trim());
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return Math.trunc(userId);
}

function trainerNameFromValue(raw: unknown): string | null {
  if (typeof raw === "string") {
    const name = raw.trim().replace(/\s+/g, " ");
    return name || null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const full = String(row.full_name ?? "").trim();
  if (full) return full.replace(/\s+/g, " ");
  const combined = [row.first_name, row.last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return combined || null;
}

type BookingTrainer = {
  userId: number | null;
  name: string | null;
  phone: string | null;
  field: string;
};

function trainerSlot(
  row: Record<string, unknown>,
  nameKey: string,
  idKey: string,
  phoneKey: string
): BookingTrainer | null {
  const nameRaw = row[nameKey];
  const userId =
    positiveId(row[idKey]) ??
    (nameRaw && typeof nameRaw === "object" && !Array.isArray(nameRaw)
      ? positiveId((nameRaw as Record<string, unknown>).user_id)
      : null);
  const name = trainerNameFromValue(nameRaw);
  const phone =
    normalizePhone(row[phoneKey]) ??
    (nameRaw && typeof nameRaw === "object" && !Array.isArray(nameRaw)
      ? normalizePhone((nameRaw as Record<string, unknown>).phone)
      : null);
  if (userId == null && !name && !phone) return null;
  const field = userId != null && row[idKey] != null && String(row[idKey]).trim() ? idKey : nameKey;
  return { userId, name, phone, field };
}

/**
 * Trainers on bookingsReport rows already fetched this run.
 * staff_member_id wins. A name is matched only against the staff roster.
 * The attendee's full_name is never treated as the trainer.
 */
export function staffTaughtFromBookings(input: {
  roster: readonly StaffPerson[];
  rows: readonly Record<string, unknown>[];
  todayYmd: string;
  nowMinutes: number;
  fromYmd: string;
  /** taught = already started, last 30 days. upcoming = not yet started, through toYmd. */
  span?: "taught" | "upcoming";
  toYmd?: string;
}): { teachers: TaughtSighting[]; match: BookingTrainerMatch } {
  const rosterIds = new Set(input.roster.map((person) => person.userId));
  const rosterByName = new Map<string, StaffPerson[]>();
  for (const person of input.roster) {
    const name = normalizeStaffName(person.name);
    if (!name) continue;
    const list = rosterByName.get(name) ?? [];
    list.push(person);
    rosterByName.set(name, list);
  }
  const fields = new Set<string>();
  const byId = new Set<number>();
  const byName = new Set<number>();
  const unmatched = new Set<string>();
  const teachers: TaughtSighting[] = [];
  const seenTeacher = new Set<string>();
  let hasId = false;

  for (const row of input.rows) {
    const classDate = String(row.date ?? row.class_date ?? "");
    const classTime = row.time ?? row.start_time ?? row.class_time;
    const classTimeText = classTime == null ? null : String(classTime);
    const inWindow =
      input.span === "upcoming"
        ? isUpcomingInWindow({
            classDate,
            classTime: classTimeText,
            todayYmd: input.todayYmd,
            nowMinutes: input.nowMinutes,
            toYmd: input.toYmd ?? input.todayYmd,
          })
        : isTaughtInWindow({
            classDate,
            classTime: classTimeText,
            todayYmd: input.todayYmd,
            nowMinutes: input.nowMinutes,
            fromYmd: input.fromYmd,
          });
    if (!inWindow) continue;
    const slots = [
      trainerSlot(row, "staff_member", "staff_member_id", "staff_member_phone"),
      trainerSlot(row, "second_staff_member", "second_staff_member_id", "second_staff_member_phone"),
    ];
    for (const slot of slots) {
      if (!slot) continue;
      fields.add(slot.field);
      if (slot.userId != null) hasId = true;
      if (slot.userId != null) {
        if (rosterIds.has(slot.userId)) {
          byId.add(slot.userId);
          const key = `id:${slot.userId}`;
          if (!seenTeacher.has(key)) {
            seenTeacher.add(key);
            teachers.push({ userId: slot.userId, phone: slot.phone, name: slot.name });
          }
        } else {
          unmatched.add(slot.name || String(slot.userId));
        }
        continue;
      }
      const nameKey = normalizeStaffName(slot.name);
      const named = nameKey ? rosterByName.get(nameKey) : undefined;
      if (!named?.length) {
        if (slot.name) unmatched.add(slot.name);
        continue;
      }
      for (const person of named) {
        if (byId.has(person.userId)) continue;
        byName.add(person.userId);
        const key = `name:${person.userId}`;
        if (seenTeacher.has(key)) continue;
        seenTeacher.add(key);
        teachers.push({ userId: person.userId, phone: person.phone, name: person.name });
      }
    }
  }

  return {
    teachers,
    match: {
      fields: [...fields].sort(),
      hasId,
      byId: byId.size,
      byName: byName.size,
      unmatched: [...unmatched].sort((a, b) => a.localeCompare(b, "he")),
    },
  };
}

export type TaughtWindow = {
  ok: true;
  teachers: TaughtSighting[];
  fromYmd: string;
  toYmd: string;
  earliestPast: string | null;
  latestPast: string | null;
  covers30Days: boolean;
};

export async function loadTaughtStaffWindow(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  now: Date
): Promise<TaughtWindow | { ok: false; error: string }> {
  const toYmd = israelYmd(now);
  const fromYmd = addDaysYmd(toYmd, -TAUGHT_LOOKBACK_DAYS);
  const nowMinutes = israelMinutes(now);
  const oldest = await admin
    .from(TRAINER_SNAPSHOT_TABLE)
    .select("class_date")
    .eq("business_id", businessId)
    .lte("class_date", toYmd)
    .order("class_date", { ascending: true })
    .limit(1);
  if (oldest.error) {
    return { ok: false, error: oldest.error.message };
  }
  const newest = await admin
    .from(TRAINER_SNAPSHOT_TABLE)
    .select("class_date")
    .eq("business_id", businessId)
    .lte("class_date", toYmd)
    .order("class_date", { ascending: false })
    .limit(1);
  if (newest.error) return { ok: false, error: newest.error.message };
  const earliestPast = oldest.data?.[0]
    ? String((oldest.data[0] as { class_date: unknown }).class_date).slice(0, 10)
    : null;
  const latestPast = newest.data?.[0]
    ? String((newest.data[0] as { class_date: unknown }).class_date).slice(0, 10)
    : null;

  const seen = new Set<string>();
  const teachers: TaughtSighting[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from(TRAINER_SNAPSHOT_TABLE)
      .select("staff_user_id, phone, class_date, class_time")
      .eq("business_id", businessId)
      .gte("class_date", fromYmd)
      .lte("class_date", toYmd)
      .range(from, from + 499);
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      const record = row as {
        staff_user_id?: unknown;
        phone?: unknown;
        class_date?: unknown;
        class_time?: unknown;
      };
      if (
        !isTaughtInWindow({
          classDate: String(record.class_date ?? ""),
          classTime: record.class_time == null ? null : String(record.class_time),
          todayYmd: toYmd,
          nowMinutes,
          fromYmd,
        })
      ) {
        continue;
      }
      const userIdRaw = Number(record.staff_user_id);
      const userId = Number.isFinite(userIdRaw) && userIdRaw > 0 ? Math.trunc(userIdRaw) : null;
      const phone = normalizePhone(record.phone);
      const key = `${userId ?? ""}|${phone ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      teachers.push({ userId, phone });
    }
    if (!data || data.length < 500) break;
  }
  return {
    ok: true,
    teachers,
    fromYmd,
    toYmd,
    earliestPast,
    latestPast,
    covers30Days: earliestPast != null && earliestPast <= fromYmd,
  };
}

/** Future assignments already stored from classesSummary. Cancelled classes are not in this table. */
export async function loadUpcomingStaffWindow(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  now: Date
): Promise<{ ok: true; teachers: TaughtSighting[] } | { ok: false; error: string }> {
  const bounds = staffUpcomingBounds(now);
  const seen = new Set<string>();
  const teachers: TaughtSighting[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from(TRAINER_SNAPSHOT_TABLE)
      .select("staff_user_id, phone, full_name, class_date, class_time")
      .eq("business_id", businessId)
      .gte("class_date", bounds.todayYmd)
      .lte("class_date", bounds.toYmd)
      .range(from, from + 499);
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      const record = row as {
        staff_user_id?: unknown;
        phone?: unknown;
        full_name?: unknown;
        class_date?: unknown;
        class_time?: unknown;
      };
      if (
        !isUpcomingInWindow({
          classDate: String(record.class_date ?? ""),
          classTime: record.class_time == null ? null : String(record.class_time),
          todayYmd: bounds.todayYmd,
          nowMinutes: bounds.nowMinutes,
          toYmd: bounds.toYmd,
        })
      ) {
        continue;
      }
      const userIdRaw = Number(record.staff_user_id);
      const userId = Number.isFinite(userIdRaw) && userIdRaw > 0 ? Math.trunc(userIdRaw) : null;
      const phone = normalizePhone(record.phone);
      const name = String(record.full_name ?? "").trim() || null;
      const key = `${userId ?? ""}|${phone ?? ""}|${name ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      teachers.push({ userId, phone, name });
    }
    if (!data || data.length < 500) break;
  }
  return { ok: true, teachers };
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

function morningStaffIndex(businessId: number): StaffIndex | undefined {
  const bridge = (globalThis as {
    __hzArboxDaily?: { context: () => { businessId: number; staffIndex?: StaffIndex } | undefined };
  }).__hzArboxDaily;
  const ctx = bridge?.context();
  if (ctx?.staffIndex && ctx.businessId === businessId) return ctx.staffIndex;
  return undefined;
}

export async function retentionStaffIndex(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<StaffIndex> {
  return morningStaffIndex(businessId) ?? loadStoredStaffIndex(admin, businessId);
}
