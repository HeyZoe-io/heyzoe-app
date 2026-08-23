import assert from "node:assert/strict";
import {
  isSfServiceUnsetForCta,
  resolveCtaSelectedServiceName,
  resolveSfServicePriceDuration,
} from "@/lib/sales-flow";

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

{
  const limitlessPersonal = resolveCtaSelectedServiceName({
    serviceCount: 8,
    knownPickedName: "אימון אישי",
    lastEventName: "",
  });
  assert.equal(limitlessPersonal, "אימון אישי");
  assert.equal(isSfServiceUnsetForCta(limitlessPersonal, 8), false);
  assert.equal(
    resolveCtaSelectedServiceName({
      serviceCount: 8,
      knownPickedName: "  ",
      lastEventName: null,
    }),
    ""
  );
  assert.equal(
    isSfServiceUnsetForCta(
      resolveCtaSelectedServiceName({
        serviceCount: 8,
        knownPickedName: "",
        lastEventName: "",
      }),
      8
    ),
    true
  );
  assert.equal(
    resolveCtaSelectedServiceName({
      serviceCount: 1,
      singleServiceName: "יוגה",
      knownPickedName: "",
      lastEventName: "",
    }),
    "יוגה"
  );
}

console.log("sales-flow-price-duration.test.ts: ok");
