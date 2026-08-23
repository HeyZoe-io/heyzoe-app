import assert from "node:assert/strict";
import {
  capWhatsAppProducts,
  DASHBOARD_MAX_PRODUCTS,
  isWhatsAppChatOverflowIndex,
  WA_MAX_PRODUCTS,
} from "@/lib/trial-service";

assert.equal(WA_MAX_PRODUCTS, 10);
assert.equal(DASHBOARD_MAX_PRODUCTS, 40);
assert.equal(isWhatsAppChatOverflowIndex(9), false);
assert.equal(isWhatsAppChatOverflowIndex(10), true);
assert.deepEqual(
  capWhatsAppProducts(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]),
  ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
);

console.log("trial-service.test.ts: ok");
