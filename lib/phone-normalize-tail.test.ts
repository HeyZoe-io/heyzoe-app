import assert from "node:assert/strict";
import { looksLikeBarePhoneMessage, normalizeIsraeliPhoneTail } from "@/lib/phone-normalize";

assert.equal(normalizeIsraeliPhoneTail("972523993005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("0523993005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("+972523993005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("+972 52-399-3005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("052-399-3005"), "523993005");
assert.equal(normalizeIsraeliPhoneTail("hello"), null);
assert.equal(normalizeIsraeliPhoneTail("123"), null);

assert.equal(looksLikeBarePhoneMessage("+972548305644"), true);
assert.equal(looksLikeBarePhoneMessage("0548305644"), true);
assert.equal(looksLikeBarePhoneMessage("972 54-830-5644"), true);
assert.equal(looksLikeBarePhoneMessage("1"), false);
assert.equal(looksLikeBarePhoneMessage("2"), false);
assert.equal(looksLikeBarePhoneMessage("hello"), false);
assert.equal(looksLikeBarePhoneMessage("המספר שלי +972548305644"), false);
assert.equal(looksLikeBarePhoneMessage("אפשר לבדוק למתי נרשמתי?"), false);

console.log("phone-normalize-tail.test.ts: ok");
