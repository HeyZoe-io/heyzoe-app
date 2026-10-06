import assert from "node:assert/strict";
import { deliverHeldEvent, nightHoldOutcome } from "@/lib/leads/crm-night-hold";

const night = new Date("2026-10-06T20:30:00.000Z");
const morning = new Date("2026-10-07T05:00:00.000Z");
const afternoon = new Date("2026-10-06T11:00:00.000Z");

assert.equal(nightHoldOutcome(night), "hold");
assert.equal(nightHoldOutcome(morning), "send");
assert.equal(nightHoldOutcome(afternoon), "send");
assert.equal(nightHoldOutcome(new Date("2026-10-06T18:00:00.000Z")), "hold");
assert.equal(nightHoldOutcome(new Date("2026-10-06T04:59:00.000Z")), "hold");

const seen = new Set<string>();
const key = "trial_booked:3543:rule:12105318";
assert.equal(deliverHeldEvent({ now: night, dedupKey: key, seen }), "held");
assert.equal(seen.size, 0);
assert.equal(deliverHeldEvent({ now: morning, dedupKey: key, seen }), "sent");
assert.equal(deliverHeldEvent({ now: morning, dedupKey: key, seen }), "already");
assert.equal(deliverHeldEvent({ now: afternoon, dedupKey: "purchase:1", seen }), "sent");
