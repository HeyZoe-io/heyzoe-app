import assert from "node:assert/strict";
import {
  ARBOX_TRIGGER_TYPES,
  NON_ARBOX_TRIGGER_TYPES,
  TRIGGER_TYPES,
  allowsDelayBefore,
  canonicalizeTriggerType,
  defaultDelayDays,
  defaultDelayDirection,
  delayDirectionForTrigger,
  forcesAfterNoProductFilter,
  forcesDelayAfter,
  formatDelayLabel,
  isArboxDependentTriggerType,
  isCreatableTriggerType,
  isIncomingLeadTriggerType,
  isTriggerType,
  isUniquePerBusinessTriggerType,
  minDelayDaysForTrigger,
  showsProductFilter,
  TRIGGER_CATALOG,
  TRIGGER_TYPE_OPTIONS,
  triggerTypeLabel,
  uniqueCreateModeFor,
  triggerSendScheduleHintHe,
} from "@/lib/trigger-catalog";
import {
  allowsDelayBefore as allowsDelayBeforeFacade,
  ARBOX_TRIGGER_TYPES as ARBOX_FROM_FACADE,
  forcesDelayAfter as forcesDelayAfterFacade,
  TRIGGER_TYPES as TRIGGER_TYPES_FACADE,
} from "@/lib/template-trigger-types";

const PREVIOUS_TRIGGER_TYPES = [
  "purchase",
  "credit_refusal",
  "trial_attended",
  "birthday",
  "membership_expiring",
  "sessions_expiring",
  "arbox_new_lead",
  "membership_cancelled",
  "incoming_lead",
  "no_response",
] as const;

const PREVIOUS_ARBOX = [
  "purchase",
  "credit_refusal",
  "trial_attended",
  "birthday",
  "membership_expiring",
  "sessions_expiring",
  "arbox_new_lead",
  "membership_cancelled",
] as const;

const PREVIOUS_UI_ORDER = [
  "incoming_lead",
  "arbox_new_lead",
  "no_response",
  "purchase",
  "credit_refusal",
  "trial_attended",
  "birthday",
  "membership_expiring",
  "sessions_expiring",
  "membership_cancelled",
] as const;

{
  assert.deepEqual([...TRIGGER_TYPES], [...PREVIOUS_TRIGGER_TYPES]);
  assert.deepEqual([...ARBOX_TRIGGER_TYPES], [...PREVIOUS_ARBOX]);
  assert.deepEqual([...NON_ARBOX_TRIGGER_TYPES], ["incoming_lead", "no_response"]);
  assert.deepEqual([...TRIGGER_TYPES_FACADE], [...TRIGGER_TYPES]);
  assert.deepEqual([...ARBOX_FROM_FACADE], [...ARBOX_TRIGGER_TYPES]);
  assert.equal(TRIGGER_CATALOG.length, PREVIOUS_TRIGGER_TYPES.length);
}

{
  assert.deepEqual(
    TRIGGER_TYPE_OPTIONS.map((o) => o.value),
    [...PREVIOUS_UI_ORDER]
  );
  assert.equal(triggerTypeLabel("incoming_lead"), "ליד מאתר/קמפיין");
  assert.equal(triggerTypeLabel("site_lead"), "ליד מאתר/קמפיין");
  assert.equal(triggerTypeLabel("arbox_new_lead"), "ליד חדש מארבוקס");
  assert.equal(triggerTypeLabel("membership_cancelled"), "ביטול מנוי");
  assert.equal(triggerTypeLabel("purchase"), "רכישה");
}

{
  for (const type of PREVIOUS_TRIGGER_TYPES) {
    assert.equal(
      showsProductFilter(type),
      type === "purchase" || type === "trial_attended" || type === "membership_cancelled"
    );
  }
}

{
  assert.equal(uniqueCreateModeFor("incoming_lead"), "hide");
  assert.equal(uniqueCreateModeFor("arbox_new_lead"), "warn");
  assert.equal(uniqueCreateModeFor("purchase"), undefined);
  assert.equal(isUniquePerBusinessTriggerType("incoming_lead"), true);
  assert.equal(isUniquePerBusinessTriggerType("arbox_new_lead"), true);
  assert.equal(isUniquePerBusinessTriggerType("no_response"), false);
}

{
  assert.equal(minDelayDaysForTrigger("no_response"), 2);
  assert.equal(defaultDelayDays("no_response"), 2);
  assert.equal(defaultDelayDays("purchase"), 0);
  assert.equal(minDelayDaysForTrigger("purchase"), 0);
}

{
  assert.equal(forcesDelayAfter("purchase"), true);
  assert.equal(forcesDelayAfter("credit_refusal"), true);
  assert.equal(forcesDelayAfter("trial_attended"), true);
  assert.equal(forcesDelayAfter("incoming_lead"), true);
  assert.equal(forcesDelayAfter("site_lead"), true);
  assert.equal(forcesDelayAfter("arbox_new_lead"), true);
  assert.equal(forcesDelayAfter("membership_cancelled"), true);
  assert.equal(forcesDelayAfter("no_response"), true);
  assert.equal(forcesDelayAfter("birthday"), false);
  assert.equal(forcesDelayAfterFacade("birthday"), false);
  assert.equal(delayDirectionForTrigger("birthday", "before"), "before");
  assert.equal(delayDirectionForTrigger("purchase", "before"), "after");
  assert.equal(allowsDelayBefore("membership_expiring"), true);
  assert.equal(allowsDelayBefore("sessions_expiring"), true);
  assert.equal(allowsDelayBefore("birthday"), false);
  assert.equal(allowsDelayBefore("purchase"), false);
  assert.equal(allowsDelayBefore("membership_cancelled"), false);
  assert.equal(allowsDelayBeforeFacade("membership_expiring"), true);
  assert.equal(defaultDelayDirection("membership_expiring"), "before");
  assert.equal(defaultDelayDirection("purchase"), "after");
  assert.equal(defaultDelayDirection("birthday"), "after");
}

{
  assert.equal(forcesAfterNoProductFilter("incoming_lead"), true);
  assert.equal(forcesAfterNoProductFilter("arbox_new_lead"), true);
  assert.equal(forcesAfterNoProductFilter("no_response"), true);
  assert.equal(forcesAfterNoProductFilter("purchase"), false);
  assert.equal(forcesAfterNoProductFilter("credit_refusal"), false);
  assert.equal(forcesAfterNoProductFilter("birthday"), false);
  assert.equal(forcesAfterNoProductFilter("membership_expiring"), false);
  assert.equal(forcesAfterNoProductFilter("membership_cancelled"), false);
}

{
  assert.equal(formatDelayLabel("no_response", 2, "after"), "2 ימי שתיקה");
  assert.equal(formatDelayLabel("incoming_lead", 0, "after"), "מיידי");
  assert.equal(formatDelayLabel("arbox_new_lead", 3, "after"), "3 ימים אחרי הליד");
  assert.equal(formatDelayLabel("birthday", 0, "after"), "ביום ההולדת");
  assert.equal(formatDelayLabel("birthday", 2, "after"), "2 ימים לפני יום ההולדת");
  assert.equal(formatDelayLabel("membership_expiring", 0, "before"), "ביום פקיעת התוקף");
  assert.equal(
    formatDelayLabel("membership_expiring", 5, "before"),
    "5 ימים לפני פקיעת התוקף"
  );
  assert.equal(formatDelayLabel("purchase", 0, "after"), "ביום האירוע");
  assert.equal(formatDelayLabel("membership_cancelled", 0, "after"), "ביום האירוע");
  assert.equal(formatDelayLabel("purchase", 1, "after"), "1 ימים אחרי האירוע");
}

{
  assert.equal(isTriggerType("site_lead"), false);
  assert.equal(isIncomingLeadTriggerType("site_lead"), true);
  assert.equal(canonicalizeTriggerType("campaign_lead"), "incoming_lead");
  assert.equal(isCreatableTriggerType("arbox_new_lead", false), false);
  assert.equal(isArboxDependentTriggerType("purchase"), true);
}

{
  for (const e of TRIGGER_CATALOG) {
    assert.equal(e.presetKey, e.type);
    assert.equal(e.recipient, "customer");
    assert.ok(e.category);
    assert.ok(e.sendHintHe.length > 0);
    assert.equal(isArboxDependentTriggerType(e.type), e.arboxOnly);
  }
}

{
  assert.match(triggerSendScheduleHintHe("purchase"), /15/);
  assert.equal(triggerSendScheduleHintHe("purchase"), triggerSendScheduleHintHe("credit_refusal"));
  assert.equal(
    triggerSendScheduleHintHe("membership_expiring"),
    triggerSendScheduleHintHe("trial_attended")
  );
  assert.equal(
    triggerSendScheduleHintHe("sessions_expiring"),
    triggerSendScheduleHintHe("membership_expiring")
  );
  assert.equal(
    triggerSendScheduleHintHe("membership_cancelled"),
    triggerSendScheduleHintHe("membership_expiring")
  );
  assert.match(triggerSendScheduleHintHe("incoming_lead"), /מיד/);
}

console.log("trigger-catalog.test.ts: ok");
