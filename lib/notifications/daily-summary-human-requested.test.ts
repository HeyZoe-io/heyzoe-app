import assert from "node:assert/strict";
import {
  humanRequestedLeadsFromEvents,
  phoneFromHumanRequestedEventSession,
} from "@/lib/notifications/daily-summary-data";

assert.equal(
  phoneFromHumanRequestedEventSession("wa_999_972508318162"),
  "972508318162"
);
assert.equal(phoneFromHumanRequestedEventSession("not-a-session"), null);

const leads = humanRequestedLeadsFromEvents({
  events: [
    { session_id: "wa_999_972508318162" },
    { session_id: "wa_999_+972508318162" },
    { session_id: "wa_999_972501112233" },
    { session_id: null },
  ],
  nameByPhone: new Map([
    ["972508318162", "ליאור"],
    ["972501112233", null],
  ]),
});

assert.equal(leads.length, 2);
assert.deepEqual(leads[0], { phone: "972508318162", full_name: "ליאור" });
assert.deepEqual(leads[1], { phone: "972501112233", full_name: null });

console.log("daily-summary-human-requested.test.ts: ok");
