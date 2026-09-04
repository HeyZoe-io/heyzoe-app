import assert from "node:assert/strict";
import {
  ARBOX_TRIGGER_TYPES,
  NON_ARBOX_TRIGGER_TYPES,
  TRIGGER_TYPES,
  allowsDelayBefore,
  canonicalizeTriggerType,
  catalogEntriesFor,
  defaultDelayDays,
  defaultDelayDirection,
  delayDirectionForTrigger,
  forcesAfterNoProductFilter,
  forcesDelayAfter,
  formatDelayLabel,
  isArboxDependentTriggerType,
  isBirthdayFamilyTriggerType,
  isCreatableTriggerType,
  isIncomingLeadTriggerType,
  isPersistedTriggerType,
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

const LIVE_AUTOMATIC = [
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
  "birthday_former",
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
  "birthday_former",
] as const;

{
  assert.deepEqual([...TRIGGER_TYPES], [...LIVE_AUTOMATIC]);
  assert.deepEqual([...ARBOX_TRIGGER_TYPES], [...PREVIOUS_ARBOX]);
  assert.deepEqual([...NON_ARBOX_TRIGGER_TYPES], ["incoming_lead", "no_response"]);
  assert.deepEqual([...TRIGGER_TYPES_FACADE], [...TRIGGER_TYPES]);
  assert.deepEqual([...ARBOX_FROM_FACADE], [...ARBOX_TRIGGER_TYPES]);
}

{
  for (const e of TRIGGER_CATALOG) {
    assert.ok(["automatic", "manual"].includes(e.activation));
    assert.ok(["leads", "members", "staff"].includes(e.audience));
    assert.equal(typeof e.implemented, "boolean");
    assert.ok(e.labelHe.length > 0);
    assert.ok(e.sendHintHe.length > 0);
    if (e.activation === "automatic" && e.implemented) {
      assert.equal(e.presetKey, e.type);
      assert.equal(isTriggerType(e.type), true);
      assert.equal(isPersistedTriggerType(e.type), true);
      assert.equal(isArboxDependentTriggerType(e.type), e.arboxOnly);
    } else {
      assert.equal(isTriggerType(e.type), false);
      assert.equal(isCreatableTriggerType(e.type, true), false);
    }
  }
}

{
  assert.equal(triggerCatalogAudience("birthday"), "members");
  assert.equal(triggerCatalogAudience("birthday_former"), "leads");
  assert.equal(triggerCatalogAudience("trial_attended"), "leads");
  assert.equal(triggerCatalogAudience("no_response"), "leads");
  assert.equal(triggerCatalogAudience("manual_membership"), "members");
  assert.equal(triggerCatalogAudience("manual_talked_not_registered"), "leads");
}

function triggerCatalogAudience(type: string) {
  const e = TRIGGER_CATALOG.find((x) => x.type === type);
  assert.ok(e);
  return e!.audience;
}

{
  const autoMembers = catalogEntriesFor({ activation: "automatic", audience: "members" });
  assert.ok(autoMembers.some((e) => e.type === "birthday" && e.implemented));
  assert.ok(autoMembers.some((e) => e.type === "hold" && !e.implemented));
  const autoLeads = catalogEntriesFor({ activation: "automatic", audience: "leads" });
  assert.ok(autoLeads.some((e) => e.type === "birthday_former" && e.implemented));
  assert.ok(autoLeads.some((e) => e.type === "lost_lead" && !e.implemented));
  const manualMembers = catalogEntriesFor({ activation: "manual", audience: "members" });
  assert.ok(manualMembers.some((e) => e.type === "manual_membership" && e.implemented));
  const manualLeads = catalogEntriesFor({ activation: "manual", audience: "leads" });
  assert.ok(manualLeads.some((e) => e.type === "manual_talked_not_registered" && e.implemented));
  assert.ok(manualLeads.some((e) => e.type === "manual_lost_leads" && !e.implemented));
  assert.deepEqual(catalogEntriesFor({ activation: "automatic", audience: "staff" }), []);
}

{
  assert.equal(isTriggerType("manual_membership"), false);
  assert.equal(isTriggerType("hold"), false);
  assert.equal(isTriggerType("birthday_former"), true);
  assert.equal(isCreatableTriggerType("birthday_former", true), true);
  assert.equal(isCreatableTriggerType("birthday_former", false), false);
  assert.equal(isCreatableTriggerType("manual_membership", true), false);
  assert.equal(isBirthdayFamilyTriggerType("birthday"), true);
  assert.equal(isBirthdayFamilyTriggerType("birthday_former"), true);
  assert.equal(isBirthdayFamilyTriggerType("purchase"), false);
}

{
  assert.equal(triggerTypeLabel("incoming_lead"), "ליד מאתר/קמפיין");
  assert.equal(triggerTypeLabel("site_lead"), "ליד מאתר/קמפיין");
  assert.equal(triggerTypeLabel("arbox_new_lead"), "ליד חדש מארבוקס");
  assert.equal(triggerTypeLabel("membership_cancelled"), "ביטול מנוי");
  assert.equal(triggerTypeLabel("birthday"), "יום הולדת (מנויים)");
  assert.equal(triggerTypeLabel("birthday_former"), "יום הולדת (לקוחות לשעבר)");
  assert.ok(TRIGGER_TYPE_OPTIONS.some((o) => o.value === "birthday_former"));
}

{
  for (const type of LIVE_AUTOMATIC) {
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
  assert.equal(forcesDelayAfter("birthday"), false);
  assert.equal(forcesDelayAfter("birthday_former"), false);
  assert.equal(forcesDelayAfterFacade("birthday"), false);
  assert.equal(delayDirectionForTrigger("birthday", "before"), "before");
  assert.equal(delayDirectionForTrigger("purchase", "before"), "after");
  assert.equal(allowsDelayBefore("membership_expiring"), true);
  assert.equal(allowsDelayBefore("birthday"), false);
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
  assert.equal(forcesAfterNoProductFilter("birthday"), false);
  assert.equal(forcesAfterNoProductFilter("membership_cancelled"), false);
}

{
  assert.equal(formatDelayLabel("no_response", 2, "after"), "2 ימי שתיקה");
  assert.equal(formatDelayLabel("incoming_lead", 0, "after"), "מיידי");
  assert.equal(formatDelayLabel("arbox_new_lead", 3, "after"), "3 ימים אחרי הליד");
  assert.equal(formatDelayLabel("birthday", 0, "after"), "ביום ההולדת");
  assert.equal(formatDelayLabel("birthday_former", 2, "after"), "2 ימים לפני יום ההולדת");
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
  assert.equal(
    triggerSendScheduleHintHe("birthday_former"),
    triggerSendScheduleHintHe("birthday")
  );
  assert.match(triggerSendScheduleHintHe("incoming_lead"), /מיד/);
  assert.match(triggerSendScheduleHintHe("manual_membership"), /ידנית/);
  assert.equal(triggerSendScheduleHintHe("hold"), "בקרוב");
}

console.log("trigger-catalog.test.ts: ok");
