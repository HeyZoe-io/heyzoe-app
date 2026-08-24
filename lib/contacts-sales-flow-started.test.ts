import assert from "node:assert/strict";
import { contactIsAnalyticsNewLead } from "@/lib/contacts-sales-flow-started";

assert.equal(contactIsAnalyticsNewLead(null, null), false);
assert.equal(contactIsAnalyticsNewLead("", "2026-08-01T00:00:00.000Z"), false);
assert.equal(contactIsAnalyticsNewLead("2026-08-10T12:00:00.000Z", null), true);
assert.equal(contactIsAnalyticsNewLead("2026-08-10T12:00:00.000Z", "2026-08-01T00:00:00.000Z"), true);
assert.equal(contactIsAnalyticsNewLead("2026-07-31T23:00:00.000Z", "2026-08-01T00:00:00.000Z"), false);

console.log("contacts-sales-flow-started.test.ts: ok");
