import assert from "node:assert/strict";
import {
  skipHumanRequestedOwnerWhatsApp,
  skipHumanRequestedOwnerWhatsAppWhenTaskCreated,
} from "@/lib/human-requested";

assert.equal(skipHumanRequestedOwnerWhatsAppWhenTaskCreated(true), true);
assert.equal(skipHumanRequestedOwnerWhatsAppWhenTaskCreated(false), false);
assert.equal(skipHumanRequestedOwnerWhatsApp({ taskCreated: true, arboxTaskHandoff: true }), true);
assert.equal(skipHumanRequestedOwnerWhatsApp({ taskCreated: false, arboxTaskHandoff: true }), true);
assert.equal(skipHumanRequestedOwnerWhatsApp({ taskCreated: false, arboxTaskHandoff: false }), false);

console.log("human-requested.test.ts: ok");
