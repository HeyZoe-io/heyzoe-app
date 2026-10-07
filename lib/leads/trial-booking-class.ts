/**
 * One classification per trial booking.
 * First sight: one GET /v3/users/memberships per unique user per run (in-run cache).
 * Pre-class sends re-check that user once before the send. Post-class keeps the snapshot.
 * A missing classification column falls back to name matching and does not throw.
 *
 * IO: 1 memberships GET per unique candidate user per run. At today's volume that is
 * about 30 calls per studio per run, about 300 at 10x. A stored trial/not_trial row
 * is not fetched again until a pre-class send.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import type { ArboxBookingReportRow } from "@/lib/leads/arbox-trial-attended";
import {
  normalizeTrialClassTime,
  trialBookingIdentityKey,
} from "@/lib/leads/arbox-trial-booking-identity";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildArboxUserMembershipsPath,
  isInForceMembership,
  parseArboxMembershipRecords,
  type ArboxUserMembershipRecord,
} from "@/lib/wa-membership-lookup";

const TABLE = "arbox_trial_booking_identity";
const LOG = "[trial-booking-class]";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type TrialBookingClass = "trial" | "not_trial" | "unknown";

export type MembershipSnap = {
  id: number | null;
  type: string;
  name: string;
  inForce: boolean;
};

let classificationColumn: boolean | null = null;

function columnMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /classification/i.test(String(error.message ?? ""));
}

export function classifyTrialBooking(input: {
  memberships: MembershipSnap[] | null;
  trialTypeIds: readonly number[];
  role: string | null;
  firstWorkout: boolean;
}): { classification: TrialBookingClass; reason: string } {
  if (input.memberships == null) return { classification: "unknown", reason: "memberships_api_error" };
  const ids = new Set(input.trialTypeIds.map((id) => Math.trunc(id)).filter((id) => id > 0));
  const inForce = input.memberships.filter((row) => row.inForce);
  // An in-force id from the trial filter is a trial even when the type is service or plan,
  // and even when another active product sits beside it.
  const trialProduct = inForce.some((row) => row.id != null && ids.has(row.id));
  if (trialProduct) return { classification: "trial", reason: "active_trial_product" };
  if (inForce.length > 0) return { classification: "not_trial", reason: "active_paid_or_service" };
  const role = String(input.role ?? "").trim().toLowerCase();
  const isLead = role === "lead" || role === "ליד";
  const isMember = role === "client" || role === "member" || role === "user";
  if (isLead || (input.firstWorkout && !isMember)) {
    return { classification: "trial", reason: "lead_no_membership" };
  }
  if (!role && input.memberships.length === 0) {
    return { classification: "unknown", reason: "no_membership_no_role" };
  }
  return { classification: "not_trial", reason: "no_trial_membership" };
}

/**
 * Stored trial/not_trial sticks. Post-class never replaces it.
 * Pre-class replaces it only at send time. An API error does not overwrite a stored class.
 */
export function classificationForPhase(input: {
  phase: "pre_class" | "post_class";
  stored: TrialBookingClass | null;
  fresh: TrialBookingClass;
  atSend: boolean;
}): TrialBookingClass {
  const storedFinal = input.stored === "trial" || input.stored === "not_trial";
  if (input.fresh === "unknown" && storedFinal) return input.stored as TrialBookingClass;
  if (input.phase === "post_class" && storedFinal) return input.stored as TrialBookingClass;
  if (input.phase === "pre_class" && storedFinal && !input.atSend) return input.stored as TrialBookingClass;
  return input.fresh;
}

export class UserMembershipCache {
  private readonly cache = new Map<number, MembershipSnap[] | null>();
  private callCount = 0;

  constructor(private readonly fetchUser: (userId: number) => Promise<MembershipSnap[] | null>) {}

  get calls(): number {
    return this.callCount;
  }

  async get(userId: number): Promise<MembershipSnap[] | null> {
    if (this.cache.has(userId)) return this.cache.get(userId) ?? null;
    this.callCount += 1;
    const value = await this.fetchUser(userId);
    this.cache.set(userId, value);
    return value;
  }
}

function bookingRole(row: ArboxBookingReportRow): string | null {
  const extra = row as ArboxBookingReportRow & { user_role?: unknown; role?: unknown };
  const role = String(extra.user_role ?? extra.role ?? "").trim();
  return role || null;
}

function bookingFirstWorkout(row: ArboxBookingReportRow): boolean {
  const extra = row as ArboxBookingReportRow & {
    is_first_session?: unknown;
    first_session?: unknown;
  };
  const raw = String(extra.is_first_session ?? extra.first_session ?? "").trim().toLowerCase();
  return raw === "yes" || raw === "1" || raw === "true";
}

function snapFromRecord(row: ArboxUserMembershipRecord, todayYmd: string): MembershipSnap {
  const idRaw = Number(row.membership_type_id);
  return {
    id: Number.isFinite(idRaw) && idRaw > 0 ? Math.trunc(idRaw) : null,
    type: String(row.type ?? "").trim(),
    name: String(row.membership_type_name ?? "").trim(),
    inForce: isInForceMembership(row, todayYmd),
  };
}

export async function fetchUserMembershipSnaps(
  apiKey: string,
  userId: number,
  todayYmd: string
): Promise<MembershipSnap[] | null> {
  try {
    const res = await arboxPublicFetch(buildArboxUserMembershipsPath(String(userId)), {
      apiKey,
      method: "GET",
    });
    if (!res.ok) return null;
    return parseArboxMembershipRecords(res.json).map((row) => snapFromRecord(row, todayYmd));
  } catch (error) {
    console.error(LOG, "memberships fetch threw", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function classificationReady(admin: Admin): Promise<boolean> {
  if (classificationColumn != null) return classificationColumn;
  const { error } = await admin.from(TABLE).select("classification").limit(1);
  if (!error) {
    classificationColumn = true;
    return true;
  }
  if (columnMissing(error) || /does not exist|42P01/i.test(error.message ?? "")) {
    classificationColumn = false;
    console.warn(LOG, "classification column missing — name match only until the migration is applied");
    return false;
  }
  console.error(LOG, "classification probe failed:", error.message);
  classificationColumn = false;
  return false;
}

type StoredRow = {
  key: string;
  classification: TrialBookingClass;
  userId: number;
  classDate: string;
  classTime: string;
};

async function loadStored(admin: Admin, businessId: number, userIds: number[]): Promise<Map<string, StoredRow> | null> {
  if (!(await classificationReady(admin))) return null;
  const map = new Map<string, StoredRow>();
  const ids = [...new Set(userIds.filter((id) => id > 0))];
  if (!ids.length) return map;
  const { data, error } = await admin
    .from(TABLE)
    .select("user_id, class_date, class_time, classification")
    .eq("business_id", businessId)
    .in("user_id", ids);
  if (error) {
    if (columnMissing(error)) {
      classificationColumn = false;
      console.warn(LOG, "classification column missing — name match only until the migration is applied");
      return null;
    }
    console.error(LOG, "load failed:", error.message);
    return null;
  }
  for (const row of data ?? []) {
    const userId = Number((row as { user_id?: unknown }).user_id);
    const classDate = String((row as { class_date?: unknown }).class_date ?? "").slice(0, 10);
    const classTime = String((row as { class_time?: unknown }).class_time ?? "");
    const key = trialBookingIdentityKey(userId, classDate, classTime);
    const classification = String((row as { classification?: unknown }).classification ?? "trial");
    if (!key) continue;
    const value: TrialBookingClass =
      classification === "not_trial" || classification === "unknown" ? classification : "trial";
    map.set(key, { key, classification: value, userId, classDate, classTime });
  }
  return map;
}

async function saveClass(input: {
  admin: Admin;
  businessId: number;
  userId: number;
  classDate: string;
  classTime: string;
  className: string;
  classification: TrialBookingClass;
  note: string;
}): Promise<void> {
  const classTime = normalizeTrialClassTime(input.classTime);
  if (!classTime) return;
  const { error } = await input.admin.from(TABLE).upsert(
    {
      business_id: input.businessId,
      user_id: input.userId,
      class_date: input.classDate,
      class_time: classTime,
      class_name: input.className || "",
      classification: input.classification,
      classification_note: input.note,
    },
    { onConflict: "business_id,user_id,class_date,class_time" }
  );
  if (!error) return;
  if (columnMissing(error)) {
    classificationColumn = false;
    console.warn(LOG, "classification column missing — name match only until the migration is applied");
    return;
  }
  console.error(LOG, "save failed:", error.message);
}

export type TrialClassRun = {
  ready: boolean;
  membershipCalls: number;
  forKeys(userId: number, classDate: string, classTime: string): TrialBookingClass | undefined;
  recheckBeforeSend(input: {
    userId: number;
    classDate: string;
    classTime: string;
    role: string | null;
    firstWorkout: boolean;
  }): Promise<TrialBookingClass | null>;
};

const fallbackRun: TrialClassRun = {
  ready: false,
  membershipCalls: 0,
  forKeys: () => undefined,
  recheckBeforeSend: async () => null,
};

function rowUserId(row: ArboxBookingReportRow): number | null {
  const userId = Number(row.user_id);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return Math.trunc(userId);
}

export async function prepareTrialBookingClasses(input: {
  admin: Admin;
  businessId: number;
  apiKey: string;
  rows: readonly ArboxBookingReportRow[];
  trialTypeIds: readonly number[];
  todayYmd: string;
  phase: "pre_class" | "post_class";
  /** Name match already decided this row is a candidate. */
  isCandidate: (row: ArboxBookingReportRow) => boolean;
}): Promise<TrialClassRun> {
  const apiKey = String(input.apiKey ?? "").trim();
  if (!apiKey) return fallbackRun;
  const userIds = input.rows
    .map(rowUserId)
    .filter((id): id is number => id != null);
  const stored = await loadStored(input.admin, input.businessId, userIds);
  if (!stored) return fallbackRun;

  const cache = new UserMembershipCache((userId) =>
    fetchUserMembershipSnaps(apiKey, userId, input.todayYmd)
  );
  const decisions = new Map<string, TrialBookingClass>();
  for (const row of stored.values()) decisions.set(row.key, row.classification);

  for (const row of input.rows) {
    const userId = rowUserId(row);
    const classDate = String(row.date ?? "").slice(0, 10);
    const classTime = String(row.time ?? "");
    const key = userId == null ? null : trialBookingIdentityKey(userId, classDate, classTime);
    if (!key || userId == null) continue;
    const existing = stored.get(key);
    const final = existing?.classification === "trial" || existing?.classification === "not_trial";
    if (final) continue;
    if (!existing && !input.isCandidate(row)) continue;
    const memberships = await cache.get(userId);
    const fresh = classifyTrialBooking({
      memberships,
      trialTypeIds: input.trialTypeIds,
      role: bookingRole(row),
      firstWorkout: bookingFirstWorkout(row),
    });
    const next = classificationForPhase({
      phase: input.phase,
      stored: existing?.classification ?? null,
      fresh: fresh.classification,
      atSend: false,
    });
    decisions.set(key, next);
    if (next === "unknown") {
      console.info(LOG, "unknown, skip this run", {
        businessId: input.businessId,
        userId,
        classDate,
        reason: fresh.reason,
      });
    }
    await saveClass({
      admin: input.admin,
      businessId: input.businessId,
      userId,
      classDate,
      classTime,
      className: String(row.class_name ?? ""),
      classification: next,
      note: fresh.reason,
    });
    stored.set(key, {
      key,
      classification: next,
      userId,
      classDate,
      classTime: normalizeTrialClassTime(classTime) ?? classTime,
    });
  }

  return {
    ready: true,
    get membershipCalls() {
      return cache.calls;
    },
    forKeys(userId, classDate, classTime) {
      const key = trialBookingIdentityKey(userId, classDate, classTime);
      if (!key) return undefined;
      return decisions.get(key);
    },
    async recheckBeforeSend(row) {
      if (input.phase !== "pre_class") return null;
      const key = trialBookingIdentityKey(row.userId, row.classDate, row.classTime);
      const storedClass = key ? decisions.get(key) ?? null : null;
      const memberships = await cache.get(row.userId);
      const fresh = classifyTrialBooking({
        memberships,
        trialTypeIds: input.trialTypeIds,
        role: row.role,
        firstWorkout: row.firstWorkout,
      });
      if (fresh.classification === "unknown") {
        console.info(LOG, "pre-send unknown, skip this run", {
          businessId: input.businessId,
          userId: row.userId,
          reason: fresh.reason,
        });
        return "unknown";
      }
      const next = classificationForPhase({
        phase: "pre_class",
        stored: storedClass,
        fresh: fresh.classification,
        atSend: true,
      });
      if (key && storedClass !== next) {
        await saveClass({
          admin: input.admin,
          businessId: input.businessId,
          userId: row.userId,
          classDate: row.classDate,
          classTime: row.classTime,
          className: "",
          classification: next,
          note: `pre_send_recheck: ${storedClass ?? "none"} -> ${next}`,
        });
        decisions.set(key, next);
      }
      return next;
    },
  };
}
