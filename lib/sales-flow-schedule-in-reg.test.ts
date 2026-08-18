import assert from "node:assert/strict";
import { shouldIncludeScheduleInRegistration } from "@/lib/sales-flow";

/** Trial/workshop with no weekly board — skip day/time in registration. */
{
  assert.equal(
    shouldIncludeScheduleInRegistration({
      offerKind: "trial",
      requestedDate: "ראשון",
      requestedTime: "08:30",
      scheduleSlotCount: 0,
    }),
    false
  );
  assert.equal(
    shouldIncludeScheduleInRegistration({
      offerKind: "workshop",
      requestedDate: "ראשון",
      requestedTime: "",
      scheduleSlotCount: 0,
    }),
    false
  );
}

/** Trial with slots and a full pick — keep schedule line. */
{
  assert.equal(
    shouldIncludeScheduleInRegistration({
      offerKind: "trial",
      requestedDate: "ראשון",
      requestedTime: "08:30",
      scheduleSlotCount: 3,
    }),
    true
  );
  assert.equal(
    shouldIncludeScheduleInRegistration({
      offerKind: "trial",
      requestedDate: "",
      requestedTime: "",
      scheduleSlotCount: 3,
    }),
    false
  );
}

/** Course: dates off → never; dates on + cycle start → yes. */
{
  assert.equal(
    shouldIncludeScheduleInRegistration({
      offerKind: "course",
      requestedDate: "01.09",
      requestedTime: "",
      scheduleSlotCount: 0,
      courseDatesEnabled: false,
    }),
    false
  );
  assert.equal(
    shouldIncludeScheduleInRegistration({
      offerKind: "course",
      requestedDate: "01.09",
      requestedTime: "",
      scheduleSlotCount: 0,
      courseDatesEnabled: true,
    }),
    true
  );
}

console.log("sales-flow-schedule-in-reg.test.ts: ok");
