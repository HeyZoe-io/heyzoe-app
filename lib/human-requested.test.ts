import assert from "node:assert/strict";
import {
  skipHumanRequestedOwnerWhatsApp,
  skipHumanRequestedOwnerWhatsAppWhenTaskCreated,
} from "@/lib/human-requested";

assert.equal(skipHumanRequestedOwnerWhatsAppWhenTaskCreated(true), true);
assert.equal(skipHumanRequestedOwnerWhatsAppWhenTaskCreated(false), false);
assert.equal(skipHumanRequestedOwnerWhatsApp({ taskCreated: true, arboxBusiness: true }), true);
assert.equal(skipHumanRequestedOwnerWhatsApp({ taskCreated: false, arboxBusiness: true }), true);
assert.equal(skipHumanRequestedOwnerWhatsApp({ taskCreated: false, arboxBusiness: false }), false);

console.log("human-requested.test.ts: ok");
