import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unsentDetailParam, unsentReason } from "@/lib/admin-daily-unsent-summary";
import {
  OPERATIONAL_KEEPS_STAFF,
  RETENTION_STAFF_TRIGGERS,
  fetchArboxStaffMembers,
  isRetentionStaff,
  isTaughtInWindow,
  parseStaffMembers,
  qualifyingStaffPeople,
  staffIndexFromPeople,
  staffTaughtFromBookings,
  type StaffPerson,
  syncArboxStaffFlags,
  triggerSkipsStaff,
} from "@/lib/leads/arbox-staff";

const inactiveCoach = parseStaffMembers([
  {
    user_id: 7928151,
    first_name: "אופיר",
    last_name: "רבינוביץ",
    phone: "0501234567",
    active: "0",
  },
  { user_id: 1206402, first_name: "אלעד", last_name: "גז", phone: "0507654321", active: "1" },
  { user_id: 1206402, first_name: "duplicate", last_name: "", phone: "", active: "1" },
]);
assert.equal(inactiveCoach.length, 2);
assert.equal(inactiveCoach[0]?.active, false);
assert.equal(inactiveCoach[0]?.name, "אופיר רבינוביץ");
assert.equal(inactiveCoach[1]?.active, true);

const index = staffIndexFromPeople(inactiveCoach, true);
assert.equal(isRetentionStaff(index, { userId: 7928151 }), true);
assert.equal(isRetentionStaff(index, { phone: "972501234567" }), true);
assert.equal(isRetentionStaff(index, { userId: 1, phone: "972509999999" }), false);
assert.equal(isRetentionStaff(staffIndexFromPeople(inactiveCoach, false), { userId: 7928151 }), false);
assert.equal(isRetentionStaff(null, { userId: 7928151 }), false);

const today = "2026-10-08";
const from = "2026-09-08";
const windowBase = { todayYmd: today, nowMinutes: 9 * 60, fromYmd: from };
assert.equal(isTaughtInWindow({ ...windowBase, classDate: "2026-09-28" }), true);
assert.equal(isTaughtInWindow({ ...windowBase, classDate: "2026-08-09" }), false);
assert.equal(isTaughtInWindow({ ...windowBase, classDate: today, classTime: "18:00" }), false);
assert.equal(isTaughtInWindow({ ...windowBase, classDate: today, classTime: "08:00" }), true);

const roster: StaffPerson[] = [
  { userId: 1, phone: "972501111111", name: "פעיל", active: true },
  { userId: 2, phone: "972502222222", name: "לימד לאחרונה", active: false },
  { userId: 3, phone: "972503333333", name: "לימד מזמן", active: false },
  { userId: 4, phone: "972504444444", name: "לא לימד", active: false },
  { userId: 5, phone: "972505555555", name: "לפי טלפון", active: false },
];
const qualifying = qualifyingStaffPeople(roster, [
  { userId: 2, phone: null },
  { userId: null, phone: "0505555555" },
]);
assert.deepEqual(
  qualifying.map((person) => person.userId),
  [1, 2, 5]
);
const narrow = staffIndexFromPeople(qualifying, true);
assert.equal(isRetentionStaff(narrow, { userId: 1 }), true);
assert.equal(isRetentionStaff(narrow, { userId: 2 }), true);
assert.equal(isRetentionStaff(narrow, { userId: 3 }), false);
assert.equal(isRetentionStaff(narrow, { userId: 4 }), false);

const taughtWindow = { todayYmd: "2026-10-08", nowMinutes: 9 * 60, fromYmd: "2026-09-08" };
const ofir: StaffPerson = { userId: 10, phone: null, name: "אופיר רבינוביץ", active: false };
const noa: StaffPerson = { userId: 11, phone: null, name: "נועה כהן", active: false };
const recentBooking = staffTaughtFromBookings({
  roster: [ofir, noa],
  rows: [
    {
      date: "2026-09-28",
      time: "18:00",
      staff_member: "אופיר  רבינוביץ",
      user_id: 999,
      full_name: "נועה כהן",
    },
    {
      date: "2026-08-24",
      time: "18:00",
      staff_member_id: "11",
      staff_member: "נועה כהן",
    },
  ],
  ...taughtWindow,
});
assert.deepEqual(recentBooking.match.fields, ["staff_member"]);
assert.equal(recentBooking.match.hasId, false);
assert.equal(recentBooking.match.byName, 1);
assert.deepEqual(
  qualifyingStaffPeople([ofir, noa], recentBooking.teachers).map((person) => person.userId),
  [10]
);
const byId = staffTaughtFromBookings({
  roster: [noa],
  rows: [{ date: "2026-09-28", time: "18:00", staff_member_id: "11", staff_member: "NOA  COHEN" }],
  ...taughtWindow,
});
assert.equal(byId.match.hasId, true);
assert.equal(byId.match.byId, 1);
assert.deepEqual(qualifyingStaffPeople([noa], byId.teachers).map((person) => person.userId), [11]);
const spaced = staffTaughtFromBookings({
  roster: [{ userId: 12, phone: null, name: "Noa Cohen", active: false }],
  rows: [{ date: "2026-09-28", time: "18:00", staff_member: "  noa   cohen " }],
  ...taughtWindow,
});
assert.equal(spaced.match.byName, 1);
const customerOnly = staffTaughtFromBookings({
  roster: [ofir],
  rows: [
    {
      date: "2026-09-28",
      time: "18:00",
      user_id: 10,
      full_name: "אופיר רבינוביץ",
      staff_member: "לקוח אחר",
    },
  ],
  ...taughtWindow,
});
assert.equal(customerOnly.teachers.length, 0);
assert.deepEqual(customerOnly.match.unmatched, ["לקוח אחר"]);
assert.equal(qualifyingStaffPeople([ofir], customerOnly.teachers).length, 0);

for (const trigger of RETENTION_STAFF_TRIGGERS) {
  assert.equal(triggerSkipsStaff(trigger), true, trigger);
}
for (const trigger of OPERATIONAL_KEEPS_STAFF) {
  assert.equal(triggerSkipsStaff(trigger), false, trigger);
}

const wired: Record<string, string> = {
  attendance_gap: "lib/leads/arbox-attendance-gap.ts",
  missed_class: "lib/leads/arbox-missed-class.ts",
  missed_trial: "lib/leads/arbox-missed-class.ts",
  lost_lead: "lib/leads/arbox-lost-lead.ts",
  lead_status_changed: "lib/leads/arbox-lead-status-change.ts",
  no_response: "lib/leads/no-response-reengage.ts",
  milestones: "lib/leads/arbox-days-in-club.ts",
  nth_workout: "lib/leads/arbox-nth-workout.ts",
  birthday: "lib/leads/arbox-birthday.ts",
  birthday_former: "lib/leads/arbox-birthday.ts",
  membership_expiring: "lib/leads/arbox-membership-expiring.ts",
  sessions_expiring: "lib/leads/arbox-sessions-expiring.ts",
  membership_cancelled: "lib/leads/arbox-membership-cancelled.ts",
  freeze_created: "lib/leads/arbox-freeze.ts",
  freeze_ending_booked: "lib/leads/arbox-freeze.ts",
  freeze_ending_unbooked: "lib/leads/arbox-freeze.ts",
};
for (const [trigger, file] of Object.entries(wired)) {
  const source = readFileSync(file, "utf8");
  assert.equal(source.includes("isRetentionStaff"), true, file);
  assert.equal(source.includes("[retention-staff] skip"), true, trigger);
  if (trigger === "missed_trial" || trigger === "freeze_ending_booked" || trigger === "freeze_ending_unbooked") {
    assert.equal(source.includes(trigger), true, trigger);
  } else {
    assert.equal(source.includes(`"${trigger}"`) || source.includes(`'${trigger}'`), true, trigger);
  }
}
for (const file of [
  "lib/leads/arbox-class-cancelled-customer.ts",
  "lib/leads/arbox-class-cancelled-staff.ts",
  "lib/leads/arbox-trial-reminder.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.equal(source.includes("isRetentionStaff"), false, file);
}

type Contact = { id: string; business_id: number; phone: string; arbox_is_staff: boolean };
function mockAdmin(contacts: Contact[], failUpdate = false) {
  let updates = 0;
  const admin = {
    from() {
      let patch: { arbox_is_staff?: boolean } | null = null;
      const filters: { col: string; op: "eq" | "in"; value: unknown }[] = [];
      const matches = () =>
        contacts.filter((row) =>
          filters.every((filter) => {
            const value = (row as Record<string, unknown>)[filter.col];
            if (filter.op === "eq") return value === filter.value;
            return Array.isArray(filter.value) && (filter.value as unknown[]).includes(value);
          })
        );
      const builder = {
        update(next: { arbox_is_staff?: boolean }) {
          updates += 1;
          patch = next;
          return builder;
        },
        select() {
          return builder;
        },
        eq(col: string, value: unknown) {
          filters.push({ col, op: "eq", value });
          return builder;
        },
        in(col: string, value: unknown) {
          filters.push({ col, op: "in", value });
          return builder;
        },
        range() {
          return builder;
        },
        then(resolve: (value: { data: { id: string }[] | null; error: { message: string } | null }) => void) {
          if (failUpdate && patch) {
            resolve({ data: null, error: { message: "update failed" } });
            return;
          }
          const rows = matches();
          if (patch?.arbox_is_staff != null) {
            for (const row of rows) row.arbox_is_staff = patch.arbox_is_staff;
          }
          resolve({ data: rows.map((row) => ({ id: row.id })), error: null });
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, updateCount: () => updates };
}

async function main(): Promise<void> {
const kept = [{ id: "a", business_id: 1, phone: "972501111111", arbox_is_staff: true }];
const incomplete = mockAdmin(kept);
const skipped = await syncArboxStaffFlags({
  admin: incomplete.admin,
  businessId: 1,
  people: [],
  reportComplete: false,
});
assert.equal(skipped.skipped, "report_incomplete");
assert.equal(incomplete.updateCount(), 0);
assert.equal(kept[0]?.arbox_is_staff, true);

const failedFetch = await fetchArboxStaffMembers({
  apiKey: "k",
  boxId: "1",
  fetchPage: async () => ({ ok: false, status: 500, json: null, rawText: "" }),
});
assert.equal(failedFetch.ok, false);

const detail = unsentDetailParam([
  {
    businessId: 1,
    business: "apex",
    trigger: "missed_class",
    contact: "א",
    reason: unsentReason({ status: "seeded", lastError: "class_unmarked", overdue: false }) ?? "",
    at: "08.10, 09:00",
  },
  {
    businessId: 1,
    business: "apex",
    trigger: "attendance_gap",
    contact: "ב",
    reason: unsentReason({ status: "seeded", lastError: "staff", overdue: false }) ?? "",
    at: "08.10, 09:00",
  },
  {
    businessId: 1,
    business: "apex",
    trigger: "attendance_gap",
    contact: "ג",
    reason: unsentReason({ status: "seeded", lastError: "frozen", overdue: false }) ?? "",
    at: "08.10, 09:00",
  },
  {
    businessId: 1,
    business: "apex",
    trigger: "attendance_gap",
    contact: "ד",
    reason: unsentReason({ status: "skipped", lastError: "retention_daily_cap", overdue: false }) ?? "",
    at: "08.10, 09:00",
  },
]);
assert.match(detail, /1 אימונים בלי סימון נוכחות/);
assert.match(detail, /1 דילוגי תקרת שימור/);
assert.match(detail, /1 הקפאות/);
assert.match(detail, /1 צוות/);

console.log("arbox-staff.test.ts ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
