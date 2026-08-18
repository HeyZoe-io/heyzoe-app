import assert from "node:assert/strict";
import { matchesSelfReportedRegistered } from "@/lib/self-reported-registered";

assert.equal(matchesSelfReportedRegistered("כבר נרשמנו"), true);
assert.equal(matchesSelfReportedRegistered("נרשמתי"), true);
assert.equal(matchesSelfReportedRegistered("נרשמנו לאפליקציה"), true);
assert.equal(matchesSelfReportedRegistered("כבר קיבלנו ונירשמנו"), true);
assert.equal(matchesSelfReportedRegistered("כבר קיבלנו ונירשמנו לאפליקציה"), true);
assert.equal(matchesSelfReportedRegistered("נירשמנו"), true);
assert.equal(matchesSelfReportedRegistered("already registered"), true);

assert.equal(matchesSelfReportedRegistered("לא נרשמנו"), false);
assert.equal(matchesSelfReportedRegistered("עדיין לא נרשמתי"), false);
assert.equal(matchesSelfReportedRegistered("טרם נרשמנו"), false);
assert.equal(matchesSelfReportedRegistered("רוצה להירשם"), false);
assert.equal(matchesSelfReportedRegistered("מתי השיעור"), false);
assert.equal(matchesSelfReportedRegistered(""), false);

console.log("self-reported-registered.test.ts: ok");
