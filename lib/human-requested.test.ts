import assert from "node:assert/strict";
import { skipHumanRequestedOwnerWhatsAppWhenTaskCreated } from "@/lib/human-requested";

assert.equal(skipHumanRequestedOwnerWhatsAppWhenTaskCreated(true), true);
assert.equal(skipHumanRequestedOwnerWhatsAppWhenTaskCreated(false), false);

console.log("human-requested.test.ts: ok");
