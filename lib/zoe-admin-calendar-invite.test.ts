import assert from "node:assert/strict";
import { buildZoeAdminInviteIcs, zoeAdminGuestEvent } from "@/lib/zoe-admin-calendar";
import {
  normalizeZoeAdminInviteEmail,
  planZoeAdminCalendarInvite,
  zoeAdminInviteMessage,
  type ZoeAdminInviteSnapshot,
} from "@/lib/zoe-admin-calendar-invite";

const empty: ZoeAdminInviteSnapshot = {
  column: null,
  emailRaw: "",
  dateYmd: null,
  timeHm: null,
};

const ready: ZoeAdminInviteSnapshot = {
  column: "setup_call",
  emailRaw: "Dana@Studio.co.il",
  dateYmd: "2026-10-08",
  timeHm: "11:30",
};

assert.equal(normalizeZoeAdminInviteEmail("  Dana@Studio.co.il "), "dana@studio.co.il");
assert.equal(normalizeZoeAdminInviteEmail("https://studio.co.il"), "");
assert.equal(normalizeZoeAdminInviteEmail("not-an-email"), "");

assert.equal(planZoeAdminCalendarInvite(empty, empty).action, "skip");
assert.equal(planZoeAdminCalendarInvite(empty, { ...ready, timeHm: "" }).action, "missing_slot");
assert.equal(planZoeAdminCalendarInvite(empty, { ...ready, column: "in_process" as never }).action, "skip");

const created = planZoeAdminCalendarInvite(empty, ready);
assert.equal(created.action, "request");
if (created.action === "request") {
  assert.equal(created.slot.email, "dana@studio.co.il");
  assert.equal(created.cancelSlot, null);
}

assert.equal(planZoeAdminCalendarInvite(ready, ready).action, "skip");
assert.equal(planZoeAdminCalendarInvite(ready, { ...ready, emailRaw: "dana@" }).action, "skip");
assert.equal(planZoeAdminCalendarInvite(ready, { ...ready, emailRaw: "" }).action, "cancel");

const moved = planZoeAdminCalendarInvite(ready, { ...ready, timeHm: "12:00" });
assert.equal(moved.action, "request");
if (moved.action === "request") assert.equal(moved.cancelSlot, null);

const retitled = planZoeAdminCalendarInvite(ready, { ...ready, column: "requires_call" });
assert.equal(retitled.action, "request");

const readdressed = planZoeAdminCalendarInvite(ready, { ...ready, emailRaw: "other@studio.co.il" });
assert.equal(readdressed.action, "request");
if (readdressed.action === "request") assert.equal(readdressed.cancelSlot?.email, "dana@studio.co.il");

assert.equal(planZoeAdminCalendarInvite(ready, { ...ready, column: null, emailRaw: "" }).action, "cancel");
assert.equal(planZoeAdminCalendarInvite(ready, { ...ready, timeHm: null }).action, "missing_slot");

const message = zoeAdminInviteMessage({
  slot: {
    email: "dana@studio.co.il",
    column: "setup_call",
    dateYmd: "2026-10-08",
    timeHm: "11:30",
  },
  businessName: "סטודיו דנה",
  cancelled: false,
});
assert.match(message.subject, /זימון: שיחת הקמה עם זואי/);
assert.match(message.subject, /8\.10\.2026 בשעה 11:30/);
assert.match(message.htmlContent, /סטודיו דנה/);

const event = zoeAdminGuestEvent({
  phone: "972501234567",
  column: "requires_call",
  dateYmd: "2026-10-08",
  timeHm: "11:30",
});
assert.ok(event);
assert.equal(event.title, "שיחה עם זואי");
const ics = buildZoeAdminInviteIcs({
  event,
  method: "REQUEST",
  attendeeEmail: "dana@studio.co.il",
  attendeeName: "סטודיו דנה",
  description: message.description,
  sequence: 10,
  now: new Date("2026-10-06T08:00:00.000Z"),
});
assert.match(ics, /METHOD:REQUEST/);
assert.match(ics, /mailto:dana@studio\.co\.il/);
assert.match(ics, /mailto:noreply@heyzoe\.io/);
assert.match(ics, /SUMMARY:שיחה עם זואי/);
assert.match(ics, /SEQUENCE:10/);

console.log("zoe-admin-calendar-invite.test.ts ok");
