/**
 * Latest trainer for class_cancelled_customer.
 * Copied from the classesSummaryReport fetch the hourly cron already makes.
 * staff_member is an object { user_id, full_name, phone }, not an array.
 * second_staff_member uses the same shape when a co-trainer is set.
 * A cancelled class leaves that report, so the phone has to be stored here first.
 */
import { parseClassDateYmd } from "@/lib/leads/arbox-trial-attended";
import { normalizePhone } from "@/lib/phone-normalize";

export const CLASS_TRAINER_SNAPSHOT_TABLE = "arbox_class_trainer_snapshot";

export type TrainerSlot = "primary" | "second";

export type TrainerSummaryRow = {
  schedule_id?: unknown;
  class_name?: unknown;
  date?: unknown;
  start_time?: unknown;
  time?: unknown;
  status?: unknown;
  staff_member?: unknown;
  second_staff_member?: unknown;
};

export type TrainerSnapshotRow = {
  schedule_id: string;
  slot: TrainerSlot;
  staff_user_id: string;
  phone: string | null;
  full_name: string | null;
  class_name: string;
  class_date: string;
  class_time: string;
  seen_at: string;
};

export type TrainerStoreFailure = "missing" | "failed";

export function isMissingTrainerSnapshotError(message: string): boolean {
  return /arbox_class_trainer_snapshot|schema cache|does not exist|42P01|PGRST205/i.test(message);
}

export function classifyTrainerStoreError(message: string): TrainerStoreFailure {
  return isMissingTrainerSnapshotError(message) ? "missing" : "failed";
}

function trimOrNull(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

function normalizeClassTimeHhmm(raw: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

function readSummaryStaff(raw: unknown): { userId: string; fullName: string | null; phone: string | null } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const userId = trimOrNull(row.user_id);
  if (!userId) return null;
  return {
    userId,
    fullName: trimOrNull(row.full_name),
    phone: normalizePhone(row.phone),
  };
}

/** Active classes only. A slot with no user id is omitted. */
export function trainersFromActiveSummary(
  rows: readonly TrainerSummaryRow[]
): Omit<TrainerSnapshotRow, "seen_at">[] {
  const out: Omit<TrainerSnapshotRow, "seen_at">[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (String(row.status ?? "").trim().toLowerCase() !== "active") continue;
    const scheduleId = trimOrNull(row.schedule_id);
    const className = trimOrNull(row.class_name);
    const classDate = parseClassDateYmd(row.date);
    const classTime = normalizeClassTimeHhmm(row.start_time) ?? normalizeClassTimeHhmm(row.time);
    if (!scheduleId || !className || !classDate || !classTime) continue;
    const slots: Array<[TrainerSlot, unknown]> = [
      ["primary", row.staff_member],
      ["second", row.second_staff_member],
    ];
    for (const [slot, raw] of slots) {
      const staff = readSummaryStaff(raw);
      if (!staff) continue;
      const key = `${scheduleId}\n${slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        schedule_id: scheduleId,
        slot,
        staff_user_id: staff.userId,
        phone: staff.phone,
        full_name: staff.fullName,
        class_name: className,
        class_date: classDate,
        class_time: classTime,
      });
    }
  }
  return out;
}

export function activeScheduleIdsFromSummary(rows: readonly TrainerSummaryRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (String(row.status ?? "").trim().toLowerCase() !== "active") continue;
    const scheduleId = trimOrNull(row.schedule_id);
    if (scheduleId) ids.add(scheduleId);
  }
  return ids;
}

function slotKey(scheduleId: string, slot: TrainerSlot): string {
  return `${scheduleId}\n${slot}`;
}

/**
 * Last sighting wins while the class is still active.
 * Same staff id keeps a stored phone when the new sighting has none.
 * A different staff id replaces the slot.
 * A class that left the summary (cancelled) is not deleted.
 */
export function planTrainerRefresh(input: {
  existing: readonly TrainerSnapshotRow[];
  sightings: readonly Omit<TrainerSnapshotRow, "seen_at">[];
  activeScheduleIds: ReadonlySet<string>;
  nowIso: string;
}): { upserts: TrainerSnapshotRow[]; deleteSlots: { schedule_id: string; slot: TrainerSlot }[] } {
  const existingByKey = new Map(input.existing.map((row) => [slotKey(row.schedule_id, row.slot), row]));
  const seen = new Set<string>();
  const upserts: TrainerSnapshotRow[] = [];
  for (const sighting of input.sightings) {
    const key = slotKey(sighting.schedule_id, sighting.slot);
    seen.add(key);
    const prev = existingByKey.get(key);
    const phone =
      prev && prev.staff_user_id === sighting.staff_user_id && !sighting.phone && prev.phone
        ? prev.phone
        : sighting.phone;
    upserts.push({ ...sighting, phone, seen_at: input.nowIso });
  }
  const deleteSlots: { schedule_id: string; slot: TrainerSlot }[] = [];
  for (const prev of input.existing) {
    if (!input.activeScheduleIds.has(prev.schedule_id)) continue;
    if (seen.has(slotKey(prev.schedule_id, prev.slot))) continue;
    deleteSlots.push({ schedule_id: prev.schedule_id, slot: prev.slot });
  }
  return { upserts, deleteSlots };
}

/**
 * No late trainer send. Already-settled registrant rows do not pull a trainer in.
 * A class with zero registrant rows still qualifies.
 */
export function shouldNotifyClassTrainer(input: {
  customerRowCount: number;
  pendingCustomerCount: number;
  newlyMarkedCount: number;
  classPassed: boolean;
}): boolean {
  if (input.classPassed) return false;
  if (input.newlyMarkedCount > 0 || input.pendingCustomerCount > 0) return true;
  return input.customerRowCount === 0;
}

export function trainerPhoneCoveredByCustomers(
  trainerPhone: string | null,
  customerPhones: readonly (string | null | undefined)[]
): boolean {
  const phone = normalizePhone(trainerPhone);
  if (!phone) return false;
  return customerPhones.some((raw) => normalizePhone(raw) === phone);
}

/** One send per rule, unless this phone is already a registrant recipient. */
export function trainerRuleIdsToSend(input: {
  ruleIds: readonly string[];
  loggedRuleIds: ReadonlySet<string>;
  coveredByCustomer: boolean;
}): string[] {
  if (input.coveredByCustomer) return [];
  return input.ruleIds.filter((id) => !input.loggedRuleIds.has(id));
}

export type TrainerSkipReason = "outside_window" | "no_snapshot" | "no_staff_phone" | "skipped_past" | "covered";

export function trainerSkipReason(input: {
  inWindow: boolean;
  classPassed: boolean;
  hasSnapshot: boolean;
  phone: string | null;
  coveredByCustomer: boolean;
}): TrainerSkipReason | null {
  if (!input.inWindow) return "outside_window";
  if (input.classPassed) return "skipped_past";
  if (!input.hasSnapshot) return "no_snapshot";
  if (!normalizePhone(input.phone)) return "no_staff_phone";
  if (input.coveredByCustomer) return "covered";
  return null;
}
