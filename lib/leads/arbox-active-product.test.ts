import assert from "node:assert/strict";
import {
  collectActiveProductKeys,
  isUpcomingTrialBooking,
  matchesActiveProduct,
  rowLooksLikeTrialProduct,
} from "@/lib/leads/arbox-active-product";

const today = "2026-09-24";
const emptyNames = new Set<string>();

{
  const keys = collectActiveProductKeys({
    membershipRows: [
      { user_id: 1, phone: "0501111111", status: "active" },
      { user_id: 2, phone: "0502222222", status: "cancelled" },
    ],
    sessionRows: [
      { user_id: 3, phone: "0503333333", status: "active" },
      { user_id: 4, phone: "0504444444", status: "expired" },
      {
        user_id: 8,
        phone: "0508888888",
        status: "active",
        membership_type_id: 586473,
        membership_type_name: "שיעור הכרות - סטודיו tights",
      },
      {
        user_id: 9,
        phone: "0509999999",
        status: "active",
        membership_type_name: "כרטיסיית ניסיון",
      },
    ],
    bookingRows: [
      {
        user_id: 5,
        phone: "0505555555",
        date: "2026-09-26",
        membership_type_name: "שיעור ניסיון",
      },
      {
        user_id: 6,
        phone: "0506666666",
        date: "2026-09-20",
        membership_type_name: "שיעור ניסיון",
      },
      {
        user_id: 7,
        phone: "0507777777",
        date: "2026-09-26",
        membership_type_name: "יוגה",
      },
    ],
    todayYmd: today,
    trialTypeIds: [586473],
    trialTypeNamesNormalized: new Set(["שיעור הכרות - סטודיו tights"]),
  });

  assert.equal(matchesActiveProduct({ userId: 1, phone: null, keys }), true);
  assert.equal(matchesActiveProduct({ userId: 2, phone: null, keys }), false);
  assert.equal(matchesActiveProduct({ userId: 3, phone: null, keys }), true);
  assert.equal(matchesActiveProduct({ userId: 4, phone: null, keys }), false);
  assert.equal(matchesActiveProduct({ userId: 5, phone: null, keys }), true);
  assert.equal(matchesActiveProduct({ userId: 6, phone: null, keys }), false);
  assert.equal(matchesActiveProduct({ userId: 7, phone: null, keys }), false);
  assert.equal(
    matchesActiveProduct({ userId: 8, phone: null, keys }),
    false,
    "configured trial punch card must not suppress win-back / C6"
  );
  assert.equal(
    matchesActiveProduct({ userId: 9, phone: null, keys }),
    false,
    "trial-named session must not suppress"
  );
  assert.equal(matchesActiveProduct({ userId: null, phone: "972501111111", keys }), true);
  assert.equal(matchesActiveProduct({ userId: 99, phone: "0509999999", keys }), false);
}

{
  const trialNames = new Set(["שיעור הכרות - סטודיו tights"]);
  assert.equal(
    rowLooksLikeTrialProduct({
      row: { membership_type_id: 586473, membership_type_name: "שיעור הכרות - סטודיו tights" },
      trialTypeIds: [586473],
      trialTypeNamesNormalized: trialNames,
    }),
    true
  );
  assert.equal(
    rowLooksLikeTrialProduct({
      row: { membership_type_name: "כרטיסייה 10" },
      trialTypeIds: [586473],
      trialTypeNamesNormalized: trialNames,
    }),
    false
  );
}

{
  assert.equal(
    isUpcomingTrialBooking({
      row: { user_id: 8, date: today, membership_type_name: "היכרות", membership_type_id: 8 },
      todayYmd: today,
      trialTypeIds: [8],
      trialTypeNamesNormalized: emptyNames,
    }),
    true
  );
}

console.log("arbox-active-product.test.ts: ok");
