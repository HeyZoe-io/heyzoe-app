import assert from "node:assert/strict";
import { matchesArboxRegistrationVerifyAsk } from "@/lib/wa-arbox-registration-verify";

assert.equal(matchesArboxRegistrationVerifyAsk("מוודאה שהיום יש לנו אימון ניסיון"), true);
assert.equal(matchesArboxRegistrationVerifyAsk("אני וחברה רשומות. רק רציתי לוודא"), true);
assert.equal(matchesArboxRegistrationVerifyAsk("רק רציתי לוודא את ההרשמה"), true);
assert.equal(matchesArboxRegistrationVerifyAsk("אני רשומה"), true);

assert.equal(matchesArboxRegistrationVerifyAsk("מתי יש אימון ניסיון היום?"), false);
assert.equal(matchesArboxRegistrationVerifyAsk("מה יש היום?"), false);
assert.equal(matchesArboxRegistrationVerifyAsk("נרשמתי"), false);
assert.equal(matchesArboxRegistrationVerifyAsk("היי"), false);

console.log("wa-arbox-registration-verify.test.ts: ok");
