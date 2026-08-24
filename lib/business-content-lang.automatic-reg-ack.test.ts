import assert from "node:assert/strict";
import { automaticRegistrationSelfReportedAck } from "@/lib/business-content-lang";
import { resolveRegistrationConfirmationMode } from "@/lib/sales-flow";

assert.equal(resolveRegistrationConfirmationMode({ registration_confirmation_mode: "automatic" }), "automatic");
assert.equal(resolveRegistrationConfirmationMode({ registration_confirmation_mode: "manual" }), "manual");
assert.equal(resolveRegistrationConfirmationMode(null), "manual");

assert.equal(automaticRegistrationSelfReportedAck("he"), "איזה כיף! מחכים לראותך");
assert.equal(automaticRegistrationSelfReportedAck("en"), "How exciting! Looking forward to seeing you");

console.log("business-content-lang.automatic-reg-ack.test.ts: ok");
