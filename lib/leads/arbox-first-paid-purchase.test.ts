import assert from "node:assert/strict";
import {
  collectExistingCustomerUserIdsToSeed,
  existingCustomerUserIdToSeed,
  isFirstPaidPurchaseSale,
} from "@/lib/leads/arbox-first-paid-purchase";

{
  assert.equal(isFirstPaidPurchaseSale({ item_type: "plan", membership_type_id: 10 }, []), true);
  assert.equal(
    isFirstPaidPurchaseSale({ item_type: "session", membership_type_id: 11, item_name: "כרטיסייה 10" }, []),
    true
  );
  assert.equal(isFirstPaidPurchaseSale({ item_type: "trial", membership_type_id: 3 }, []), false);
  assert.equal(isFirstPaidPurchaseSale({ item_type: "service", membership_type_id: 4 }, []), false);
  assert.equal(
    isFirstPaidPurchaseSale({ item_type: "plan", membership_type_id: 3, item_name: "מנוי" }, [3]),
    false
  );
  assert.equal(
    isFirstPaidPurchaseSale(
      { item_type: "session", membership_type_id: 8, item_name: "שיעור ניסיון" },
      []
    ),
    false
  );
}

{
  const today = "2026-09-23";
  assert.equal(
    existingCustomerUserIdToSeed(
      { user_id: 9, status: "active", member_since: "2026-01-01", membership_type_id: 10 },
      [],
      today,
      "membership"
    ),
    9
  );
  assert.equal(
    existingCustomerUserIdToSeed(
      { user_id: 9, status: "active", member_since: today, membership_type_id: 10 },
      [],
      today,
      "membership"
    ),
    null
  );
  assert.equal(
    existingCustomerUserIdToSeed(
      { user_id: 4, status: "active", membership_type_id: 3, membership_type_name: "ניסיון" },
      [3],
      today,
      "membership"
    ),
    null
  );
  assert.equal(
    existingCustomerUserIdToSeed(
      { user_id: 5, status: "active", start_date: "2026-08-01", membership_type_name: "10 אימונים" },
      [],
      today,
      "session"
    ),
    5
  );
  assert.equal(
    existingCustomerUserIdToSeed(
      { user_id: 6, status: "cancelled", start_date: "2026-08-01" },
      [],
      today,
      "session"
    ),
    null
  );

  assert.deepEqual(
    collectExistingCustomerUserIdsToSeed({
      membershipRows: [
        { user_id: 9, status: "active", member_since: "2026-01-01", membership_type_id: 10 },
        { user_id: 1, status: "active", member_since: today, membership_type_id: 10 },
      ],
      sessionRows: [
        { user_id: 5, status: "active", start_date: "2026-08-01", membership_type_name: "10 אימונים" },
        { user_id: 9, status: "active", start_date: "2026-08-01", membership_type_name: "10 אימונים" },
      ],
      trialMembershipTypeIds: [],
      todayYmd: today,
    }),
    [9, 5]
  );
}

console.log("arbox-first-paid-purchase.test.ts: ok");
