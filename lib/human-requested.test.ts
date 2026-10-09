import assert from "node:assert/strict";
import {
  shouldForceHumanRequestedOwnerWhatsApp,
  skipHumanRequestedOwnerWhatsAppWhenTaskCreated,
} from "@/lib/human-requested";

assert.equal(skipHumanRequestedOwnerWhatsAppWhenTaskCreated(true), true);
assert.equal(skipHumanRequestedOwnerWhatsAppWhenTaskCreated(false), false);
assert.equal(shouldForceHumanRequestedOwnerWhatsApp({ taskCreated: false, taskFailed: true }), true);
assert.equal(shouldForceHumanRequestedOwnerWhatsApp({ taskCreated: true, taskFailed: true }), false);
assert.equal(shouldForceHumanRequestedOwnerWhatsApp({ taskCreated: false, taskFailed: false }), false);

console.log("human-requested.test.ts: ok");
