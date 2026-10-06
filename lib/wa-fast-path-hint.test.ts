import assert from "node:assert/strict";
import { decideHintAction } from "@/lib/wa-fast-path-hint";
import { extractReplyRoute } from "@/lib/wa-reply-route";

function decide(raw: string, category: string | null) {
  return decideHintAction({
    hint: category ? { matcher: "test", category } : null,
    extracted: extractReplyRoute(raw),
  });
}

assert.equal(decide("[[route:handoff]]\nאעביר לצוות", "cancellation"), "use_hint");
assert.equal(decide("[[route:booking_change]]\nאעביר", "reschedule"), "use_hint");
assert.equal(decide("[[route:booking_change]]\nתבטלי את השיעור", "cancellation"), "ignore_hint");
assert.equal(decide("[[route:booking_change]]\nתבטלי את השיעור", "freeze"), "ignore_hint");
assert.equal(decide("[[route:booking_change]]\nתבטלי את השיעור", "class_cancel"), "use_hint");
assert.equal(decide("[[route:answer]]\nאפשר להצטרף במקומה", "cancellation"), "ignore_hint");
assert.equal(decide("[[route:schedule]]\nהנה המערכת", "cancellation"), "ignore_hint");
assert.equal(decide("בלי תג", "cancellation"), "use_hint");
assert.equal(decide("[[route:nope]]\nטקסט", "freeze"), "use_hint");
assert.equal(decide("[[route:signup]]\nבואי נתחיל", "signup"), "use_hint");
assert.equal(decide("[[route:answer]]\nמחיר", "signup"), "ignore_hint");
assert.equal(decide("בלי תג", "signup"), "ignore_hint");
assert.equal(decide("[[route:signup]]\nבואי", "cancellation"), "ignore_hint");
assert.equal(decide("[[route:signup]]\nאשלח מחיר", "registration_no_member"), "use_hint");
assert.equal(decide("[[route:handoff]]\nצוות", null), "ignore_hint");
assert.equal(decide("[[route:handoff]]\nצוות", "schedule"), "ignore_hint");

const friend = "חברה שלי ביטלה ואני רוצה להצטרף במקומה";
const cancel = "אני רוצה לבטל את המנוי";
assert.equal(decide(`[[route:answer]]\n${friend}`, "cancellation"), "ignore_hint");
assert.equal(decide(`[[route:handoff]]\n${cancel}`, "cancellation"), "use_hint");

console.log("wa-fast-path-hint.test.ts: ok");
