import assert from "node:assert/strict";
import {
  ARBOX_TRIAL_ITEM_TYPE_SOCIAL_KEY,
  arboxTrialConfig,
  arboxTrialItemTypeCountsFromSocial,
  isArboxTrialSale,
  isConfiguredArboxTrialMembershipTypeId,
} from "@/lib/arbox-trial-sale";
import { purchaseSaleClass } from "@/lib/template-triggers-match";

const LIST = [622016];
const off = arboxTrialConfig(LIST, false);
const on = arboxTrialConfig(LIST, true);

const listed = { membership_type_id: 622016, item_type: "session" };
const trialType = { membership_type_id: 262718, item_type: "trial" };
const sessionType = { membership_type_id: 632088, item_type: "session" };
const noType = { membership_type_id: 262718 };

// Setting off: list only, exactly as today.
assert.equal(isArboxTrialSale(listed, off), true);
assert.equal(isArboxTrialSale(trialType, off), false);
assert.equal(isArboxTrialSale(sessionType, off), false);
assert.equal(isArboxTrialSale(noType, off), false);
assert.equal(isArboxTrialSale({ membership_type_id: "622016", item_type: "plan" }, off), true);

// Setting on: list OR item type trial.
assert.equal(isArboxTrialSale(listed, on), true);
assert.equal(isArboxTrialSale(trialType, on), true);
assert.equal(isArboxTrialSale({ ...trialType, item_type: " Trial " }, on), true);
assert.equal(isArboxTrialSale(sessionType, on), false, "session item not in the list is not a trial");
assert.equal(isArboxTrialSale(noType, on), false, "missing item type falls back to the list");
assert.equal(isArboxTrialSale({ membership_type_id: 622016 }, on), true);
assert.equal(isArboxTrialSale({ membership_type_id: null, item_type: "trial" }, on), true);

// Bad ids never match.
for (const id of [null, undefined, "", 0, -5, "abc", Number.NaN]) {
  assert.equal(isConfiguredArboxTrialMembershipTypeId(id, [0, -5]), false);
}
assert.equal(isConfiguredArboxTrialMembershipTypeId(622016, null), false);

// Empty list, setting off: nothing is a trial.
assert.equal(isArboxTrialSale(trialType, arboxTrialConfig([], false)), false);
assert.equal(isArboxTrialSale(trialType, arboxTrialConfig(undefined, true)), true);

// Storage: only a literal true turns it on.
assert.equal(arboxTrialItemTypeCountsFromSocial({ [ARBOX_TRIAL_ITEM_TYPE_SOCIAL_KEY]: true }), true);
for (const v of [false, "true", 1, null, undefined]) {
  assert.equal(arboxTrialItemTypeCountsFromSocial({ [ARBOX_TRIAL_ITEM_TYPE_SOCIAL_KEY]: v }), false);
}
assert.equal(arboxTrialItemTypeCountsFromSocial(null), false);
assert.equal(arboxTrialItemTypeCountsFromSocial([]), false);
assert.equal(arboxTrialConfig(LIST, null).itemTypeCountsAsTrial, false);

// purchaseSaleClass: off is today's table, on promotes item type trial.
const legacy = (mid: number | null, itemType: string | null, ids: number[]) => {
  if (mid != null && ids.includes(mid)) return "trial";
  const n = String(itemType ?? "").trim().toLowerCase();
  if (n === "trial") return null;
  return ["plan", "session", "service"].includes(n) ? n : null;
};
for (const mid of [622016, 262718, 632088, null]) {
  for (const itemType of ["trial", "session", "plan", "service", "item", "", null]) {
    assert.equal(purchaseSaleClass(mid, itemType, LIST), legacy(mid, itemType, LIST), `off ${mid} ${itemType}`);
    assert.equal(purchaseSaleClass(mid, itemType, LIST, false), legacy(mid, itemType, LIST));
    const expectOn = itemType === "trial" ? "trial" : legacy(mid, itemType, LIST);
    assert.equal(purchaseSaleClass(mid, itemType, LIST, true), expectOn, `on ${mid} ${itemType}`);
  }
}

// Sales scope: off keeps exactly today's rows; on adds only item type trial.
async function scopeChecks() {
  const { filterSalesRowsForMembershipScope } = await import("@/lib/leads/arbox-trial-sync-run");
  const { resolvePurchaseSaleMembershipScope, saleMembershipTypeInScope } = await import("@/lib/template-triggers-match");
  const rows: Record<string, unknown>[] = [listed, trialType, sessionType, noType, { membership_type_id: 777, item_type: "plan" }];
  const ruleSets = [[], [{ product_filter: [777] }], [{ product_filter: null, item_type_filter: ["plan" as const] }]];
  for (const ids of [LIST, [] as number[]]) {
    for (const purchaseRules of ruleSets) {
      const scope = resolvePurchaseSaleMembershipScope({ trialMembershipTypeIds: ids, purchaseRules });
      const today = rows.filter((r) => {
        const n = Number(r.membership_type_id);
        return saleMembershipTypeInScope(Number.isFinite(n) && n > 0 ? n : null, scope);
      });
      assert.deepEqual(filterSalesRowsForMembershipScope(rows, scope, arboxTrialConfig(ids, false)), today);
      const withOn = filterSalesRowsForMembershipScope(rows, scope, arboxTrialConfig(ids, true));
      assert.deepEqual(
        withOn,
        rows.filter((r) => today.includes(r) || r === trialType)
      );
      assert.ok(!withOn.includes(sessionType) || today.includes(sessionType));
    }
  }
}

scopeChecks()
  .then(() => console.log("arbox-trial-sale tests passed"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
