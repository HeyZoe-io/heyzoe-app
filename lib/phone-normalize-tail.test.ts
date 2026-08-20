import assert from "node:assert/strict";
import { normalizeIsraeliPhoneTail } from "@/lib/phone-normalize";

assert.equal(normalizeIsraeliPhoneTail("972523993005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("0523993005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("+972523993005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("+972 52-399-3005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("052-399-3005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("hello"), null);
assert.equal(normalizeIsraeliPhoneTail("123"), null);

console.log("phone-normalize-tail.test.ts: ok");
