/**
 * First sighting of a trial booking.
 * registered_after_trial re-reads bookingsReport. Arbox can drop
 * membership_type_name after a purchase, so the live name is not enough.
 * A missing table falls back to name-only matching and does not throw.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

const TABLE = "arbox_trial_booking_identity";
const LOG = "[arbox-trial-booking-identity]";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type TrialIdentityInput = {
  userId: number;
  classDate: string;
  classTime: string;
  className: string;
  membershipTypeName: string | null;
};

let missingTableWarned = false;

export function normalizeTrialClassTime(raw: unknown): string | null {
  const match = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function trialBookingIdentityKey(
  userId: number,
  classDate: string,
  classTime: string
): string | null {
  const date = String(classDate ?? "").trim().slice(0, 10);
  const time = normalizeTrialClassTime(classTime);
  if (!Number.isFinite(userId) || userId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) {
    return null;
  }
  return `${Math.trunc(userId)}|${date}|${time}`;
}

export function trialIdentityInputsFromRows<T>(
  rows: readonly T[],
  isLiveTrial: (row: T) => boolean,
  read: (row: T) => {
    userId: number | null;
    classDate: string | null;
    classTime: unknown;
    className: unknown;
    membershipTypeName: unknown;
  }
): TrialIdentityInput[] {
  const out: TrialIdentityInput[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isLiveTrial(row)) continue;
    const parts = read(row);
    if (parts.userId == null || !parts.classDate) continue;
    const time = normalizeTrialClassTime(parts.classTime);
    const key = time ? trialBookingIdentityKey(parts.userId, parts.classDate, time) : null;
    if (!time || !key || seen.has(key)) continue;
    seen.add(key);
    const label = String(parts.membershipTypeName ?? "").trim();
    out.push({
      userId: parts.userId,
      classDate: parts.classDate,
      classTime: time,
      className: String(parts.className ?? "").trim(),
      membershipTypeName: label || null,
    });
  }
  return out;
}

function isMissingIdentityTable(message: string): boolean {
  return /arbox_trial_booking_identity|schema cache|does not exist|42P01|42703/i.test(message);
}

function warnMissingTable(): void {
  if (missingTableWarned) return;
  missingTableWarned = true;
  console.warn(LOG, "table missing; trial match stays name-only until the migration runs");
}

export async function loadTrialBookingIdentityKeys(input: {
  admin: Admin;
  businessId: number;
  fromDate?: string;
  toDate?: string;
  userIds?: readonly number[];
}): Promise<Set<string>> {
  const keys = new Set<string>();
  const userIds = [...new Set((input.userIds ?? []).filter((id) => Number.isFinite(id) && id > 0))];
  let query = input.admin
    .from(TABLE)
    .select("user_id, class_date, class_time, classification")
    .eq("business_id", input.businessId);
  if (input.fromDate) query = query.gte("class_date", input.fromDate);
  if (input.toDate) query = query.lte("class_date", input.toDate);
  if (userIds.length) query = query.in("user_id", userIds);

  let { data, error } = await query;
  if (error && /classification/i.test(error.message)) {
    let retry = input.admin
      .from(TABLE)
      .select("user_id, class_date, class_time")
      .eq("business_id", input.businessId);
    if (input.fromDate) retry = retry.gte("class_date", input.fromDate);
    if (input.toDate) retry = retry.lte("class_date", input.toDate);
    if (userIds.length) retry = retry.in("user_id", userIds);
    const again = await retry;
    data = again.data as typeof data;
    error = again.error;
  }
  if (error) {
    if (isMissingIdentityTable(error.message)) warnMissingTable();
    else console.error(LOG, "load failed:", error.message);
    return keys;
  }
  for (const row of data ?? []) {
    const classification = String((row as { classification?: unknown }).classification ?? "trial");
    if (classification === "not_trial" || classification === "unknown") continue;
    const userId = Number((row as { user_id?: unknown }).user_id);
    const classDate = String((row as { class_date?: unknown }).class_date ?? "").slice(0, 10);
    const classTime = String((row as { class_time?: unknown }).class_time ?? "");
    const key = trialBookingIdentityKey(userId, classDate, classTime);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * First insert stays pending (`unknown`, empty note). The column default is
 * `trial`, which the classifier treats as final, so the classification is set
 * explicitly. A later sighting does not overwrite a row that already exists.
 */
export function trialIdentityUpsertRow(businessId: number, item: TrialIdentityInput) {
  return {
    business_id: businessId,
    user_id: item.userId,
    class_date: item.classDate,
    class_time: normalizeTrialClassTime(item.classTime),
    class_name: item.className || "",
    membership_type_name: item.membershipTypeName,
    classification: "unknown" as const,
    classification_note: null as string | null,
  };
}

/** Idempotent. A later sighting does not overwrite the first label. */
export async function rememberTrialBookingIdentities(
  admin: Admin,
  businessId: number,
  items: readonly TrialIdentityInput[]
): Promise<void> {
  if (!items.length || !Number.isFinite(businessId) || businessId <= 0) return;
  const byKey = new Map<string, TrialIdentityInput>();
  for (const item of items) {
    const key = trialBookingIdentityKey(item.userId, item.classDate, item.classTime);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, item);
  }
  const rows = [...byKey.values()].map((item) => trialIdentityUpsertRow(businessId, item));
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await admin.from(TABLE).upsert(chunk, {
      onConflict: "business_id,user_id,class_date,class_time",
      ignoreDuplicates: true,
    });
    if (!error) continue;
    if (isMissingIdentityTable(error.message)) {
      warnMissingTable();
      return;
    }
    if (/classification/i.test(error.message)) {
      const plain = chunk.map((row) => ({
        business_id: row.business_id,
        user_id: row.user_id,
        class_date: row.class_date,
        class_time: row.class_time,
        class_name: row.class_name,
        membership_type_name: row.membership_type_name,
      }));
      const again = await admin.from(TABLE).upsert(plain, {
        onConflict: "business_id,user_id,class_date,class_time",
        ignoreDuplicates: true,
      });
      if (!again.error) continue;
      if (isMissingIdentityTable(again.error.message)) {
        warnMissingTable();
        return;
      }
      console.error(LOG, "remember failed:", again.error.message);
      return;
    }
    console.error(LOG, "remember failed:", error.message);
    return;
  }
}
