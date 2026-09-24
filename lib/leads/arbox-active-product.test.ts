import assert from "node:assert/strict";
import {
  collectActiveProductKeys,
  isUpcomingTrialBooking,
  matchesActiveProduct,
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
    trialTypeIds: [],
    trialTypeNamesNormalized: emptyNames,
  });

  assert.equal(matchesActiveProduct({ userId: 1, phone: null, keys }), true);
  assert.equal(matchesActiveProduct({ userId: 2, phone: null, keys }), false);
  assert.equal(matchesActiveProduct({ userId: 3, phone: null, keys }), true);
  assert.equal(matchesActiveProduct({ userId: 4, phone: null, keys }), false);
  assert.equal(matchesActiveProduct({ userId: 5, phone: null, keys }), true);
  assert.equal(matchesActiveProduct({ userId: 6, phone: null, keys }), false);
  assert.equal(matchesActiveProduct({ userId: 7, phone: null, keys }), false);
  assert.equal(matchesActiveProduct({ userId: null, phone: "972501111111", keys }), true);
  assert.equal(matchesActiveProduct({ userId: 99, phone: "0509999999", keys }), false);
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
