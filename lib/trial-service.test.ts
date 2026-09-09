import assert from "node:assert/strict";
import {
  capKnowledgeCatalogProducts,
  capWhatsAppProducts,
  DASHBOARD_MAX_PRODUCTS,
  isWhatsAppChatOverflowIndex,
  resolveKnowledgeCatalogServices,
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

const twelve = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
assert.deepEqual(capKnowledgeCatalogProducts(twelve), twelve);
assert.equal(capKnowledgeCatalogProducts(Array.from({ length: 41 }, (_, i) => i)).length, 40);
assert.deepEqual(
  resolveKnowledgeCatalogServices({ knowledgeCatalog: twelve, salesFlow: twelve.slice(0, 10) }),
  twelve
);
assert.deepEqual(
  resolveKnowledgeCatalogServices({ knowledgeCatalog: [], salesFlow: twelve.slice(0, 10) }),
  twelve.slice(0, 10),
  "legacy packs without knowledgeCatalog still use sales flow"
);

console.log("trial-service.test.ts: ok");
