import assert from "node:assert/strict";
import {
  ARBOX_TRIGGER_TYPES,
  NON_ARBOX_TRIGGER_TYPES,
  TRIGGER_TYPES,
  allowsDelayBefore,
  canonicalizeTriggerType,
  catalogEntriesFor,
  creatableCatalogEntriesForCell,
  creatableTriggerOptionsForCell,
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
  plannedCatalogEntriesForCell,
  showsProductFilter,
  showsItemTypeFilter,
  isImmediateDelayTrigger,
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
  "registered_after_trial",
  "not_registered_after_trial",
  "birthday",
  "membership_expiring",
  "sessions_expiring",
  "arbox_new_lead",
  "membership_cancelled",
  "incoming_lead",
  "no_response",
  "birthday_former",
  "freeze_created",
  "freeze_ending_unbooked",
  "freeze_ending_booked",
  "attendance_gap_booked",
  "attendance_gap_unbooked",
  "missed_class",
  "missed_trial",
] as const;

const PREVIOUS_ARBOX = [
  "purchase",
  "credit_refusal",
  "registered_after_trial",
  "not_registered_after_trial",
  "birthday",
  "membership_expiring",
  "sessions_expiring",
  "arbox_new_lead",
  "membership_cancelled",
  "birthday_former",
  "freeze_created",
  "freeze_ending_unbooked",
  "freeze_ending_booked",
  "attendance_gap_booked",
  "attendance_gap_unbooked",
  "missed_class",
  "missed_trial",
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
  assert.equal(triggerCatalogAudience("registered_after_trial"), "leads");
  assert.equal(triggerCatalogAudience("not_registered_after_trial"), "leads");
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
  assert.ok(autoMembers.some((e) => e.type === "freeze_created" && e.implemented));
  assert.ok(autoMembers.some((e) => e.type === "freeze_ending_unbooked" && e.implemented));
  assert.ok(autoMembers.some((e) => e.type === "freeze_ending_booked" && e.implemented));
  assert.equal(
    autoMembers.some((e) => (e.type as string) === "hold"),
    false
  );
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

/** Create dropdown is cell-scoped — not the flat TRIGGER_TYPE_OPTIONS catalog. */
{
  const memberTypes = creatableTriggerOptionsForCell({
    activation: "automatic",
    audience: "members",
    hasArbox: true,
  }).map((o) => o.value as string);
  assert.ok(memberTypes.includes("purchase"));
  assert.ok(memberTypes.includes("birthday"));
  assert.ok(memberTypes.includes("membership_cancelled"));
  assert.ok(memberTypes.includes("missed_class"));
  assert.ok(memberTypes.includes("attendance_gap_booked"));
  assert.ok(memberTypes.includes("attendance_gap_unbooked"));
  assert.ok(!memberTypes.includes("registered_after_trial"));
  assert.ok(!memberTypes.includes("incoming_lead"));
  assert.ok(!memberTypes.includes("missed_trial"));
  assert.ok(!memberTypes.includes("arbox_new_lead"));
  assert.ok(memberTypes.includes("freeze_created"));
  assert.ok(memberTypes.includes("freeze_ending_unbooked"));
  assert.ok(memberTypes.includes("freeze_ending_booked"));
  assert.ok(!(memberTypes as string[]).includes("hold"), "legacy planned hold removed");
  assert.ok(!memberTypes.includes("manual_membership"), "manual not in automatic create");

  const leadTypes = creatableTriggerOptionsForCell({
    activation: "automatic",
    audience: "leads",
    hasArbox: true,
  }).map((o) => o.value as string);
  assert.ok(leadTypes.includes("incoming_lead"));
  assert.ok(leadTypes.includes("registered_after_trial"));
  assert.ok(leadTypes.includes("not_registered_after_trial"));
  assert.ok(!leadTypes.includes("trial_attended"));
  assert.ok(leadTypes.includes("birthday_former"));
  assert.ok(leadTypes.includes("missed_trial"));
  assert.ok(!leadTypes.includes("purchase"));
  assert.ok(!leadTypes.includes("birthday"));
  assert.ok(!leadTypes.includes("missed_class"));
  assert.ok(!leadTypes.includes("lost_lead"), "planned lost_lead is not creatable");
  assert.ok(!(leadTypes as string[]).includes("post_trial_followup"));

  assert.deepEqual(
    creatableTriggerOptionsForCell({
      activation: "automatic",
      audience: "staff",
      hasArbox: true,
    }),
    []
  );
  assert.deepEqual(
    creatableTriggerOptionsForCell({
      activation: "manual",
      audience: "members",
      hasArbox: true,
    }),
    [],
    "manual cell uses campaign flow, not trigger create dropdown"
  );
  assert.deepEqual(
    creatableTriggerOptionsForCell({
      activation: "manual",
      audience: "leads",
      hasArbox: true,
    }),
    []
  );
}

/** Card UI: unique types hide create card once present; non-unique keep create-another. */
{
  const leadsEmpty = creatableCatalogEntriesForCell({
    activation: "automatic",
    audience: "leads",
    hasArbox: true,
    existingTriggerTypes: [],
  }).map((e) => e.type);
  assert.ok(leadsEmpty.includes("incoming_lead"));
  assert.ok(leadsEmpty.includes("registered_after_trial"));
  assert.ok(leadsEmpty.includes("not_registered_after_trial"));
  assert.ok(leadsEmpty.includes("missed_trial"));

  const leadsWithIncoming = creatableCatalogEntriesForCell({
    activation: "automatic",
    audience: "leads",
    hasArbox: true,
    existingTriggerTypes: ["site_lead"],
  }).map((e) => e.type);
  assert.ok(!leadsWithIncoming.includes("incoming_lead"), "unique incoming_lead: no create card");
  assert.ok(leadsWithIncoming.includes("registered_after_trial"), "non-unique still creatable");

  const leadsWithArboxNew = creatableCatalogEntriesForCell({
    activation: "automatic",
    audience: "leads",
    hasArbox: true,
    existingTriggerTypes: ["arbox_new_lead"],
  }).map((e) => e.type);
  assert.ok(!leadsWithArboxNew.includes("arbox_new_lead"));

  const membersWithPurchase = creatableCatalogEntriesForCell({
    activation: "automatic",
    audience: "members",
    hasArbox: true,
    existingTriggerTypes: ["purchase", "purchase"],
  }).map((e) => e.type);
  assert.ok(membersWithPurchase.includes("purchase"), "non-unique: create-another card stays");
  assert.ok(membersWithPurchase.includes("missed_class"));
  assert.ok(membersWithPurchase.includes("attendance_gap_booked"));

  const plannedMembers = plannedCatalogEntriesForCell({
    activation: "automatic",
    audience: "members",
  }).map((e) => e.type);
  assert.ok(!(plannedMembers as string[]).includes("hold"));
  assert.ok(!plannedMembers.includes("freeze_created"));
  assert.ok(!(plannedMembers as string[]).includes("freeze_ending"));
  assert.ok(!(plannedMembers as string[]).includes("attendance_gap"));
  assert.ok(!plannedMembers.includes("attendance_gap_booked"));
  assert.ok(!plannedMembers.includes("missed_class"));

  const plannedLeads = plannedCatalogEntriesForCell({
    activation: "automatic",
    audience: "leads",
  }).map((e) => e.type);
  assert.ok(plannedLeads.includes("lost_lead"));
  assert.ok(!plannedLeads.includes("incoming_lead"));
  assert.ok(!plannedLeads.includes("missed_trial"));

  const creatableOrders = creatableCatalogEntriesForCell({
    activation: "automatic",
    audience: "leads",
    hasArbox: true,
    existingTriggerTypes: [],
  }).map((e) => e.uiOrder);
  for (let i = 1; i < creatableOrders.length; i += 1) {
    assert.ok(creatableOrders[i]! >= creatableOrders[i - 1]!);
  }
  const plannedOrders = plannedCatalogEntriesForCell({
    activation: "automatic",
    audience: "leads",
  }).map((e) => e.uiOrder);
  for (let i = 1; i < plannedOrders.length; i += 1) {
    assert.ok(plannedOrders[i]! >= plannedOrders[i - 1]!);
  }
}

{
  assert.equal(isTriggerType("manual_membership"), false);
  assert.equal(isTriggerType("hold"), false);
  assert.equal(isTriggerType("freeze_created"), true);
  assert.equal(isTriggerType("freeze_ending_unbooked"), true);
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
      type === "purchase" ||
        type === "registered_after_trial" ||
        type === "not_registered_after_trial" ||
        type === "membership_cancelled" ||
        type === "missed_trial"
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
  assert.equal(forcesDelayAfter("purchase"), false);
  assert.equal(forcesDelayAfter("credit_refusal"), false);
  assert.equal(forcesDelayAfter("membership_cancelled"), false);
  assert.equal(forcesDelayAfter("registered_after_trial"), true);
  assert.equal(forcesDelayAfter("not_registered_after_trial"), true);
  assert.equal(forcesDelayAfter("birthday"), false);
  assert.equal(forcesDelayAfter("birthday_former"), false);
  assert.equal(forcesDelayAfterFacade("birthday"), false);
  assert.equal(isImmediateDelayTrigger("purchase"), true);
  assert.equal(isImmediateDelayTrigger("credit_refusal"), true);
  assert.equal(isImmediateDelayTrigger("membership_cancelled"), true);
  assert.equal(isImmediateDelayTrigger("registered_after_trial"), false);
  assert.equal(showsItemTypeFilter("purchase"), true);
  assert.equal(showsItemTypeFilter("credit_refusal"), false);
  assert.equal(delayDirectionForTrigger("birthday", "before"), "before");
  assert.equal(delayDirectionForTrigger("purchase", "before"), "after");
  assert.equal(allowsDelayBefore("membership_expiring"), true);
  assert.equal(allowsDelayBefore("birthday"), true);
  assert.equal(allowsDelayBefore("birthday_former"), true);
  assert.equal(allowsDelayBefore("purchase"), false);
  assert.equal(allowsDelayBefore("freeze_ending_unbooked"), true);
  assert.equal(allowsDelayBeforeFacade("membership_expiring"), true);
  assert.equal(allowsDelayBeforeFacade("birthday"), true);
  assert.equal(defaultDelayDirection("membership_expiring"), "before");
  assert.equal(defaultDelayDirection("freeze_ending_booked"), "before");
  assert.equal(defaultDelayDirection("purchase"), "after");
  assert.equal(defaultDelayDirection("birthday"), "after");
  assert.equal(defaultDelayDirection("birthday_former"), "after");
  assert.equal(isImmediateDelayTrigger("freeze_created"), true);
  assert.equal(defaultDelayDays("freeze_ending_unbooked"), 3);
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
  assert.equal(formatDelayLabel("birthday", 14, "before"), "14 ימים לפני יום ההולדת");
  assert.equal(formatDelayLabel("birthday_former", 2, "after"), "2 ימים אחרי יום ההולדת");
  assert.equal(formatDelayLabel("birthday_former", 2, "before"), "2 ימים לפני יום ההולדת");
  assert.equal(formatDelayLabel("membership_expiring", 0, "before"), "ביום פקיעת התוקף");
  assert.equal(
    formatDelayLabel("membership_expiring", 5, "before"),
    "5 ימים לפני פקיעת התוקף"
  );
  assert.equal(formatDelayLabel("purchase", 0, "after"), "נשלח מיד");
  assert.equal(formatDelayLabel("membership_cancelled", 0, "after"), "נשלח מיד");
  assert.equal(formatDelayLabel("credit_refusal", 1, "after"), "נשלח מיד");
  assert.equal(formatDelayLabel("attendance_gap_booked", 7, "after"), "7 ימי היעדרות");
  assert.equal(formatDelayLabel("attendance_gap_unbooked", 21, "after"), "21 ימי היעדרות");
  assert.equal(minDelayDaysForTrigger("attendance_gap_booked"), 7);
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
    triggerSendScheduleHintHe("registered_after_trial")
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
  assert.equal(
    triggerSendScheduleHintHe("freeze_created"),
    triggerSendScheduleHintHe("membership_expiring")
  );
  assert.equal(triggerSendScheduleHintHe("hold"), "");
}

console.log("trigger-catalog.test.ts: ok");
