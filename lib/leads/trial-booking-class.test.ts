import assert from "node:assert/strict";
import { bookingMatchesTrialScope } from "@/lib/leads/arbox-trial-attended";
import {
  classificationForPhase,
  classifyTrialBooking,
  UserMembershipCache,
} from "@/lib/leads/trial-booking-class";

const chairScope = {
  trialTypeIds: [501966, 586475],
  trialTypeNamesNormalized: new Set(["chair pilates"]),
};

const eyla = {
  user_id: 9941656,
  membership_type_name: "Chair Pilates",
  date: "2026-10-06",
  time: "18:30",
};

assert.equal(bookingMatchesTrialScope(eyla, chairScope), true);
assert.equal(bookingMatchesTrialScope(eyla, chairScope, "not_trial"), false);
const today = "2026-10-07";
assert.equal(
  classifyTrialBooking({
    memberships: [
      { id: 501966, type: "service", name: "Chair Pilates", inForce: true },
      { id: 800, type: "plan", name: "מנוי 8", inForce: true },
    ],
    trialTypeIds: chairScope.trialTypeIds,
    role: "client",
    firstWorkout: false,
    todayYmd: today,
  }).classification,
  "trial"
);
assert.equal(
  classifyTrialBooking({
    memberships: [
      { id: 501966, type: "service", name: "Chair Pilates", inForce: false, endedOn: "2026-09-20" },
      { id: 501480, type: "plan", name: "מנוי 8 +1 כניסות בחודש", inForce: true },
    ],
    trialTypeIds: chairScope.trialTypeIds,
    role: "client",
    firstWorkout: false,
    todayYmd: today,
  }).reason,
  "active_paid_or_service"
);
assert.equal(
  classifyTrialBooking({
    memberships: [
      {
        id: 586475,
        type: "session",
        name: "2 אימוני היכרות פילאטיס מכשירים",
        inForce: false,
        endedOn: "2026-10-13",
      },
    ],
    trialTypeIds: chairScope.trialTypeIds,
    role: "client",
    firstWorkout: false,
    todayYmd: today,
  }).reason,
  "recent_trial_product"
);
assert.equal(
  classifyTrialBooking({
    memberships: [{ id: 361094, type: "trial", name: "APEX Flex", inForce: false, endedOn: "2026-10-06" }],
    trialTypeIds: [622016, 442268],
    role: "lead",
    firstWorkout: true,
    todayYmd: today,
  }).reason,
  "recent_trial_product"
);
assert.equal(
  classifyTrialBooking({
    memberships: [{ id: 100, type: "plan", name: "מנוי שנתי", inForce: false, endedOn: "2026-08-01" }],
    trialTypeIds: [622016],
    role: "client",
    firstWorkout: false,
    todayYmd: today,
  }).reason,
  "former_member"
);
assert.equal(
  classifyTrialBooking({
    memberships: [{ id: 628345, type: "item", name: "שיעור הכרות סטודיו טייטס", inForce: false, endedOn: null }],
    trialTypeIds: [628345],
    role: "client",
    firstWorkout: false,
    todayYmd: today,
  }).reason,
  "recent_trial_product"
);
assert.equal(
  classifyTrialBooking({
    memberships: [{ id: 586475, type: "session", name: "2 אימוני היכרות", inForce: false, endedOn: "2026-09-06" }],
    trialTypeIds: [586475],
    role: "client",
    firstWorkout: false,
    todayYmd: today,
  }).classification,
  "not_trial"
);

const lead = {
  user_id: 12103176,
  membership_type_name: "trialClassTitle",
  user_role: "lead",
  is_first_session: "Yes",
};
assert.equal(
  classifyTrialBooking({
    memberships: [],
    trialTypeIds: [628345],
    role: "lead",
    firstWorkout: true,
    todayYmd: "2026-10-07",
  }).classification,
  "trial"
);
assert.equal(bookingMatchesTrialScope(lead, { trialTypeIds: [628345], trialTypeNamesNormalized: new Set() }, "trial"), true);

assert.equal(
  classificationForPhase({
    phase: "pre_class",
    stored: "trial",
    fresh: "not_trial",
    atSend: true,
  }),
  "not_trial"
);
assert.equal(
  classificationForPhase({
    phase: "post_class",
    stored: "trial",
    fresh: "not_trial",
    atSend: false,
  }),
  "trial"
);
assert.equal(
  classifyTrialBooking({
    memberships: null,
    trialTypeIds: [1],
    role: "lead",
    firstWorkout: true,
    todayYmd: "2026-10-07",
  }).classification,
  "unknown"
);

async function oneCallPerUser() {
  let calls = 0;
  const cache = new UserMembershipCache(async () => {
    calls += 1;
    return [];
  });
  await cache.get(7);
  await cache.get(7);
  await cache.get(8);
  assert.equal(calls, 2);
  assert.equal(cache.calls, 2);
}
void oneCallPerUser();
