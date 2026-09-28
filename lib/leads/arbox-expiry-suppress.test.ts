import assert from "node:assert/strict";
import {
  hasAnotherActiveMembership,
  indexActiveMemberships,
  isIntroWorkoutProductName,
  membershipExpiringIdFromDedupKey,
  sessionsExpiringIdentityFromDedupKey,
} from "@/lib/leads/arbox-expiry-suppress";

assert.equal(isIntroWorkoutProductName("2 אימוני היכרות פילאטיס מכשירים"), true);
assert.equal(isIntroWorkoutProductName("אימון היכרות"), true);
assert.equal(isIntroWorkoutProductName("חודש היכרות ללקוחות חדשים בלבד! ללא הגבלה"), false);
assert.equal(isIntroWorkoutProductName("אימון בודד פילאטיס מכשירים"), false);
assert.equal(isIntroWorkoutProductName("4 כניסות פילאטיס מכשירים"), false);

const twoPlans = indexActiveMemberships([
  {
    status: "active",
    user_id: 1,
    membership_user_id: 10,
    membership_type_name: "מנוי חודשי",
  },
  {
    status: "active",
    user_id: 1,
    membership_user_id: 11,
    membership_type_name: "מנוי שני",
  },
  {
    status: "inactive",
    user_id: 2,
    membership_user_id: 20,
    membership_type_name: "לא פעיל",
  },
]);

assert.equal(hasAnotherActiveMembership(twoPlans, 1, null), true);
assert.equal(hasAnotherActiveMembership(twoPlans, 1, 10), true);
assert.equal(hasAnotherActiveMembership(twoPlans, 2, null), false);
assert.equal(hasAnotherActiveMembership(twoPlans, 9, null), false);

const onePlan = indexActiveMemberships([
  {
    status: "activeMemberWithFutureCancel",
    user_id: 3,
    membership_user_id: 30,
    membership_type_name: "מנוי",
  },
]);
assert.equal(hasAnotherActiveMembership(onePlan, 3, 30), false);
assert.equal(hasAnotherActiveMembership(onePlan, 3, null), true);

const identity = sessionsExpiringIdentityFromDedupKey(
  "sessions_expiring:3251:11111111-1111-1111-1111-111111111111:10662049:2026-08-24:2026-09-21"
);
assert.equal(identity?.userId, 10662049);
assert.equal(identity?.startDateYmd, "2026-08-24");
assert.equal(identity?.endDateYmd, "2026-09-21");
assert.equal(
  membershipExpiringIdFromDedupKey(
    "membership_expiring:3251:11111111-1111-1111-1111-111111111111:17557509:2026-09-24"
  ),
  17557509
);

console.log("arbox-expiry-suppress.test.ts: ok");
