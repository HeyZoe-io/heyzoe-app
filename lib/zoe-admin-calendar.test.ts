import assert from "node:assert/strict";
import type { LeadRow } from "@/lib/leads-types";
import {
  buildZoeAdminCalendarIcs,
  zoeAdminCalendarEventFromLead,
  zoeAdminCalendarLocation,
  zoeAdminCalendarTitle,
} from "@/lib/zoe-admin-calendar";
import { zoeAdminCalendarEventsFromRows } from "@/lib/zoe-admin-calendar-feed";

const base: LeadRow = {
  phone: "972501234567",
  full_name: "דנה",
  source: "זואי אדמין",
  created_at: "2026-10-01T10:00:00.000Z",
  opted_out: false,
  not_relevant_at: null,
  not_relevant_reason: null,
  human_requested_at: null,
  human_followup_at: null,
  next_call_at: "2026-10-08",
  next_call_time: "11:30",
  session_phase: null,
  trial_registered: false,
  wa_no_response_at: null,
  no_response_notified_at: null,
  wa_followup_stage: null,
  last_contact_at: null,
  cta_clicked_at: null,
  pipeline_status: "setup_call",
};

assert.equal(zoeAdminCalendarTitle("setup_call", "דנה"), "שיחת הקמה (דנה) - זואי");
assert.equal(zoeAdminCalendarTitle("requires_call", "  יוסי "), "דורש שיחה (יוסי) - זואי");
assert.equal(zoeAdminCalendarTitle("requires_call", ""), "דורש שיחה (לקוח) - זואי");
assert.equal(zoeAdminCalendarLocation("972501234567"), "0501234567");
assert.equal(zoeAdminCalendarLocation("+972501234567"), "0501234567");
assert.equal(zoeAdminCalendarLocation("0501234567"), "0501234567");

const setup = zoeAdminCalendarEventFromLead(base);
assert.ok(setup);
assert.equal(setup.title, "שיחת הקמה (דנה) - זואי");
assert.equal(setup.location, "0501234567");
assert.equal(setup.endUtc.getTime() - setup.startUtc.getTime(), 30 * 60 * 1000);

const requires = zoeAdminCalendarEventFromLead({
  ...base,
  pipeline_status: "human_followup",
  full_name: "יוסי",
});
assert.equal(requires?.title, "דורש שיחה (יוסי) - זואי");

assert.equal(
  zoeAdminCalendarEventFromLead({ ...base, pipeline_status: "followup" }),
  null
);
assert.equal(zoeAdminCalendarEventFromLead({ ...base, next_call_time: null }), null);
assert.equal(zoeAdminCalendarEventFromLead({ ...base, next_call_at: null }), null);

const noteWins = zoeAdminCalendarEventsFromRows(
  [
    {
      phone: "972501234567",
      full_name: "דנה",
      next_call_at: "2026-10-08",
      next_call_time: "11:30",
      pipeline_status: "setup_call",
    },
  ],
  [{ phone: "972501234567", status: "followup", relevance: "relevant" }]
);
assert.equal(noteWins.length, 0);

const fromNote = zoeAdminCalendarEventsFromRows(
  [
    {
      phone: "0509876543",
      full_name: "מיכל",
      next_call_at: "2026-10-09",
      next_call_time: "16:00",
      pipeline_status: "setup_call",
    },
  ],
  [{ phone: "0509876543", status: "requires_call", relevance: "relevant" }]
);
assert.equal(fromNote.length, 1);
assert.equal(fromNote[0]?.title, "דורש שיחה (מיכל) - זואי");
assert.equal(fromNote[0]?.location, "0509876543");

const ics = buildZoeAdminCalendarIcs(setup ? [setup] : [], new Date("2026-10-06T08:00:00.000Z"));
assert.match(ics, /SUMMARY:שיחת הקמה \(דנה\) - זואי/);
assert.match(ics, /LOCATION:0501234567/);
assert.match(ics, /BEGIN:VALARM/);
assert.ok(ics.endsWith("\r\n"));

console.log("zoe-admin-calendar.test.ts ok");
