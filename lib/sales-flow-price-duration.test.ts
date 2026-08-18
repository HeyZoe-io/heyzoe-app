import assert from "node:assert/strict";
import { isSfServiceUnsetForCta, resolveSfServicePriceDuration } from "@/lib/sales-flow";

const all = [
  { priceText: "99", durationText: "50" },
  { priceText: "80", durationText: "45" },
];

assert.deepEqual(resolveSfServicePriceDuration(null, all), { priceText: "", durationText: "" });
assert.deepEqual(resolveSfServicePriceDuration(undefined, all), { priceText: "", durationText: "" });

assert.deepEqual(resolveSfServicePriceDuration({ priceText: "80", durationText: "45" }, all), {
  priceText: "80",
  durationText: "45",
});

assert.deepEqual(resolveSfServicePriceDuration({ priceText: "80", durationText: "" }, all), {
  priceText: "80",
  durationText: "50",
});

assert.equal(isSfServiceUnsetForCta("", 3), true);
assert.equal(isSfServiceUnsetForCta("  ", 2), true);
assert.equal(isSfServiceUnsetForCta("POWER & HIIT", 3), false);
assert.equal(isSfServiceUnsetForCta("", 1), false);

console.log("sales-flow-price-duration.test.ts: ok");
