import assert from "node:assert/strict";
import {
  purchaseSameDaySentKey,
  purchaseTemplateCollapsedForSameDay,
  rememberPurchaseSameDaySend,
  saleDateYmdFromRaw,
} from "@/lib/leads/arbox-trial-sale-registered";

const trigger = "db457133-a28a-4578-8d94-f5ac60b02911";
const otherTrigger = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

assert.equal(saleDateYmdFromRaw("2026-10-06"), "2026-10-06");
assert.equal(saleDateYmdFromRaw("2026-10-06T08:00:00"), "2026-10-06");
assert.equal(saleDateYmdFromRaw(""), "");

assert.equal(
  purchaseSameDaySentKey({
    userId: "4163942",
    saleDateYmd: "2026-10-06",
    triggerId: trigger,
  }),
  `4163942|2026-10-06|${trigger}`
);
assert.equal(
  purchaseSameDaySentKey({
    userId: "4163942",
    saleDateYmd: "2026-10-06",
    triggerId: "00000000-0000-0000-0000-000000000000",
  }),
  null
);
assert.equal(
  purchaseSameDaySentKey({ userId: "", saleDateYmd: "2026-10-06", triggerId: trigger }),
  null
);

const sent = new Set<string>();
const first = { userId: "4163942", saleDateYmd: "2026-10-06", triggerId: trigger };
assert.equal(purchaseTemplateCollapsedForSameDay(sent, first), false);
rememberPurchaseSameDaySend(sent, first);
assert.equal(purchaseTemplateCollapsedForSameDay(sent, first), true);
assert.equal(
  purchaseTemplateCollapsedForSameDay(sent, { ...first, saleDateYmd: "2026-10-07" }),
  false,
  "a purchase on another day still sends"
);
assert.equal(
  purchaseTemplateCollapsedForSameDay(sent, { ...first, triggerId: otherTrigger }),
  false,
  "a different purchase rule still sends"
);
assert.equal(
  purchaseTemplateCollapsedForSameDay(sent, { ...first, userId: "999" }),
  false
);
assert.equal(purchaseTemplateCollapsedForSameDay(undefined, first), false);

console.log("purchase-same-day-send.test.ts: ok");
