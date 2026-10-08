import assert from "node:assert/strict";
import {
  hasAnotherActiveMembership,
  indexActiveMemberships,
  isIntroWorkoutProductName,
  productNameTotalSessions,
  sessionsExpiringExcludedProduct,
  trialTypeNamesFromRows,
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

// Tights (3543) Oct 8: Adi 11632993 and Adi 11721062 were queued for sessions_expiring on this product.
assert.equal(isIntroWorkoutProductName("שיעור הכרות - סטודיו tights"), true);
assert.equal(sessionsExpiringExcludedProduct({ name: "שיעור הכרות - סטודיו tights" }), "intro_workout");
assert.equal(sessionsExpiringExcludedProduct({ name: "שיעור היכרות" }), "intro_workout");
assert.equal(sessionsExpiringExcludedProduct({ name: "חודש היכרות ללקוחות חדשים בלבד! ללא הגבלה" }), null);
assert.equal(sessionsExpiringExcludedProduct({ name: "כרטיסיית ניסיון 3 כניסות" }), "trial_product");
assert.equal(
  sessionsExpiringExcludedProduct({ name: "Welcome pack", membershipTypeId: 77, trialTypeIds: [77] }),
  "trial_product"
);
assert.equal(
  sessionsExpiringExcludedProduct({
    name: "Welcome pack",
    trialTypeIds: [77],
    trialTypeNamesNormalized: trialTypeNamesFromRows([{ membership_type_id: 77, membership_type_name: "Welcome pack" }], [77]),
  }),
  "trial_product"
);
assert.equal(sessionsExpiringExcludedProduct({ name: "אימון בודד פילאטיס מכשירים" }), "single_session");
assert.equal(sessionsExpiringExcludedProduct({ name: "כניסה אחת" }), "single_session");
assert.equal(sessionsExpiringExcludedProduct({ name: "כרטיסיה של 1 כניסות" }), "single_session");
assert.equal(sessionsExpiringExcludedProduct({ name: "כרטיסיה של 10 כניסות - חיילת" }), null);
assert.equal(sessionsExpiringExcludedProduct({ name: "4 כניסות פילאטיס מכשירים" }), null);
assert.equal(productNameTotalSessions("כרטיסיה של 10 כניסות - חיילת"), 10);
assert.equal(productNameTotalSessions("כרטיסייה"), null);
assert.equal(trialTypeNamesFromRows([{ membership_type_id: 5, membership_type_name: "x" }], []).size, 0);

console.log("arbox-expiry-suppress.test.ts: ok");
