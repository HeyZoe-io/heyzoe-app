import assert from "node:assert/strict";
import { isSameWhatsAppPeer, shouldSkipStudioAutoReplyPeer } from "@/lib/wa-bot-loop-guard";

assert.equal(isSameWhatsAppPeer("+972 3 382 3805", "97233823805"), true);
assert.equal(isSameWhatsAppPeer("0559902641", "972559902641"), true);
assert.equal(isSameWhatsAppPeer("0559902641", "0508318162"), false);

assert.equal(shouldSkipStudioAutoReplyPeer("+97233824981", "+972 3 382 3805"), true);
assert.equal(shouldSkipStudioAutoReplyPeer("97233824981", null), true);
assert.equal(shouldSkipStudioAutoReplyPeer("0559902641", "+972 55-990-2641"), true);
assert.equal(shouldSkipStudioAutoReplyPeer("0559902641", "+972 3 382 3805"), false);
assert.equal(shouldSkipStudioAutoReplyPeer("972559902641", null), false);

console.log("wa-bot-loop-guard.test.ts: ok");
