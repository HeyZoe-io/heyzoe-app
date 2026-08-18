import assert from "node:assert/strict";
import { arboxSaleHasOutstandingDebt } from "@/lib/leads/arbox-trial-sale-registered";

/** Outstanding debt = payment link / invoice — not a completed registration. */
{
  assert.equal(arboxSaleHasOutstandingDebt({ debt: 99 }), true);
  assert.equal(arboxSaleHasOutstandingDebt({ debt: "99" }), true);
  assert.equal(arboxSaleHasOutstandingDebt({ debt: 0.5 }), true);
}

/** Settled: debt 0 even if paid < list price (discount) or sub_action is still Debt. */
{
  assert.equal(arboxSaleHasOutstandingDebt({ debt: 0 }), false);
  assert.equal(arboxSaleHasOutstandingDebt({ debt: "0" }), false);
}

/** Free trial / missing debt field — do not block. */
{
  assert.equal(arboxSaleHasOutstandingDebt({}), false);
  assert.equal(arboxSaleHasOutstandingDebt({ debt: null }), false);
  assert.equal(arboxSaleHasOutstandingDebt({ debt: "" }), false);
}

console.log("arbox-trial-sale-paid.test.ts: ok");
