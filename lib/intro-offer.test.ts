import assert from "node:assert/strict";
import {
  introAdminState,
  introPaymentPatch,
  introPeriodEndsAt,
  introReminderIsDue,
} from "@/lib/intro-offer";

const paid = new Date("2026-09-27T07:00:00.000Z");
const ends = introPeriodEndsAt(paid);
assert.equal(ends.toISOString(), "2026-10-27T07:00:00.000Z");

const jan31 = introPeriodEndsAt(new Date("2026-01-31T12:00:00.000Z"));
assert.equal(jan31.toISOString(), "2026-02-28T12:00:00.000Z");

const endsIso = ends.toISOString();
assert.equal(
  introAdminState({ introPeriodEndsAt: endsIso, now: new Date("2026-10-01T00:00:00.000Z") }),
  "active"
);
assert.equal(
  introAdminState({ introPeriodEndsAt: endsIso, now: new Date("2026-10-28T00:00:00.000Z") }),
  "awaiting_full_price"
);
assert.equal(
  introAdminState({
    introPeriodEndsAt: endsIso,
    introFullPriceAt: "2026-10-24T00:00:00.000Z",
    now: new Date("2026-10-01T00:00:00.000Z"),
  }),
  "none"
);

assert.equal(
  introReminderIsDue({
    introPeriodEndsAt: endsIso,
    now: new Date("2026-10-20T07:00:00.000Z"),
  }),
  false
);
assert.equal(
  introReminderIsDue({
    introPeriodEndsAt: endsIso,
    now: new Date("2026-10-24T07:00:00.000Z"),
  }),
  true
);
assert.equal(
  introReminderIsDue({
    introPeriodEndsAt: endsIso,
    introReminderSentAt: "2026-10-24T08:00:00.000Z",
    now: new Date("2026-10-24T09:00:00.000Z"),
  }),
  false
);

const first = introPaymentPatch({ marker: "intro", paidAt: paid });
assert.equal(first.applyCatalogPrice, true);
assert.equal(first.plan, "premium");
assert.equal(first.plan_price, 5);
assert.equal(first.intro_period_ends_at, endsIso);

const repeat = introPaymentPatch({
  marker: "intro",
  paidAt: new Date("2026-10-27T07:00:00.000Z"),
  existingIntroEndsAt: endsIso,
});
assert.equal(repeat.applyCatalogPrice, false);
assert.equal(repeat.plan, undefined);

const closed = introPaymentPatch({
  marker: "pro",
  paidAt: new Date("2026-10-24T07:00:00.000Z"),
  existingIntroEndsAt: endsIso,
});
assert.equal(closed.plan, "premium");
assert.equal(closed.plan_price, 429);
assert.equal(closed.intro_full_price_at, "2026-10-24T07:00:00.000Z");

console.log("intro-offer.test.ts ok");
