import assert from "node:assert/strict";
import {
  extractBodyVarCount,
  isMetaTemplateContentEditable,
  isPresetAvailable,
  paramSlotsForTriggerType,
  parseDashboardTemplateComponents,
  TEMPLATE_PRESETS,
  uniqueTemplateName,
} from "@/lib/template-presets";

assert.equal(TEMPLATE_PRESETS.incoming_lead.body, TEMPLATE_PRESETS.arbox_new_lead.body);
assert.equal(TEMPLATE_PRESETS.incoming_lead.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.arbox_new_lead.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.registered_after_trial.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.registered_after_trial.button_text, "אשמח לפרטים");
assert.equal(
  TEMPLATE_PRESETS.registered_after_trial.body,
  "היי {{1}}, איך היה בשיעור הניסיון ({{2}})? שמחנו לראות שנרשמת להמשך — איך אפשר לעזור?"
);
assert.equal(TEMPLATE_PRESETS.not_registered_after_trial.category, "MARKETING");
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.registered_after_trial.body), 2);
assert.equal(TEMPLATE_PRESETS.no_response.button_text, "אשמח לפרטים");
assert.equal(TEMPLATE_PRESETS.membership_expiring.button_text, "חידוש מנוי");
assert.equal(TEMPLATE_PRESETS.sessions_expiring.button_text, "חידוש כרטיסיה");
assert.equal(TEMPLATE_PRESETS.purchase.button_text, undefined);
assert.equal(TEMPLATE_PRESETS.birthday_former.category, "MARKETING");
assert.deepEqual(paramSlotsForTriggerType("birthday_former"), ["first_name", "business_name"]);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.birthday_former.body), 2);
assert.equal(TEMPLATE_PRESETS.membership_cancelled.button_text, undefined);
assert.equal(
  TEMPLATE_PRESETS.membership_cancelled.body,
  "ביטול המנוי {{1}} עודכן במערכת בהצלחה✔️ תוקף המנוי הינו עד תאריך {{2}}."
);
assert.equal(TEMPLATE_PRESETS.missed_class.category, "UTILITY");
assert.equal(TEMPLATE_PRESETS.missed_class.button_text, undefined);
assert.equal(
  TEMPLATE_PRESETS.missed_class.body,
  "היי {{1}}, ראינו שנרשמת ל{{2}} ולא הגעת, הכל בסדר?"
);
assert.equal(TEMPLATE_PRESETS.missed_trial.category, "MARKETING");
assert.equal(
  TEMPLATE_PRESETS.missed_trial.body,
  "היי {{1}}, ראינו שנרשמת לשיעור ניסיון ({{2}}) ולא הגעת. מה קרה? מתי נוח לקבוע מחדש?"
);
assert.deepEqual(paramSlotsForTriggerType("missed_class"), ["first_name", "class_name"]);
assert.deepEqual(paramSlotsForTriggerType("missed_trial"), ["first_name", "class_name"]);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.missed_class.body), 2);
assert.equal(isPresetAvailable("missed_class", false), false);
assert.equal(isPresetAvailable("missed_class", true), true);
assert.equal(isPresetAvailable("missed_trial", true), true);
assert.equal(TEMPLATE_PRESETS.attendance_gap.category, "MARKETING");
assert.deepEqual(paramSlotsForTriggerType("attendance_gap"), [
  "first_name",
  "business_name",
]);
assert.equal(isPresetAvailable("attendance_gap", false), false);
assert.equal(isPresetAvailable("attendance_gap", true), true);
assert.equal(TEMPLATE_PRESETS.freeze_created.category, "UTILITY");
assert.equal(TEMPLATE_PRESETS.freeze_ending_unbooked.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.freeze_ending_booked.category, "UTILITY");
assert.deepEqual(paramSlotsForTriggerType("freeze_created"), [
  "first_name",
  "start_date",
  "expiry_date",
]);
assert.deepEqual(paramSlotsForTriggerType("freeze_ending_unbooked"), [
  "first_name",
  "expiry_date",
]);
assert.deepEqual(paramSlotsForTriggerType("freeze_ending_booked"), [
  "first_name",
  "class_name",
  "expiry_date",
]);
assert.equal(isPresetAvailable("freeze_created", true), true);
assert.equal(TEMPLATE_PRESETS.lost_lead.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.lost_lead.button_text, "אשמח לפרטים");
assert.deepEqual(paramSlotsForTriggerType("lost_lead"), ["first_name"]);
assert.equal(isPresetAvailable("lost_lead", false), false);
assert.equal(isPresetAvailable("lost_lead", true), true);
assert.equal(TEMPLATE_PRESETS.trial_reminder.category, "UTILITY");
assert.equal(TEMPLATE_PRESETS.trial_reminder.button_text, undefined);
assert.deepEqual(paramSlotsForTriggerType("trial_reminder"), [
  "first_name",
  "class_name",
  "class_time",
]);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.trial_reminder.body), 3);
assert.equal(isPresetAvailable("trial_reminder", false), false);
assert.equal(isPresetAvailable("trial_reminder", true), true);
assert.equal(TEMPLATE_PRESETS.milestones.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.milestones.name, "milestones");
assert.equal(TEMPLATE_PRESETS.milestones.button_text, undefined);
assert.equal(
  TEMPLATE_PRESETS.milestones.body,
  "היי {{1}}, היחס האישי ורמת האימון חשובים לנו, נשמח לשמוע איך הולך."
);
assert.deepEqual(paramSlotsForTriggerType("milestones"), ["first_name"]);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.milestones.body), 1);
assert.equal(isPresetAvailable("milestones", false), false);
assert.equal(isPresetAvailable("milestones", true), true);
assert.equal(TEMPLATE_PRESETS.nth_workout.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.nth_workout.name, "nth_workout");
assert.equal(TEMPLATE_PRESETS.nth_workout.button_text, undefined);
assert.equal(
  TEMPLATE_PRESETS.nth_workout.body,
  "היי {{1}}, ראינו שהיית לאחרונה, זה כבר האימון ה-{{2}} שלך אצלנו, נשמח לפידבק ולהגדיר מטרות."
);
assert.deepEqual(paramSlotsForTriggerType("nth_workout"), ["first_name", "workout_n"]);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.nth_workout.body), 2);
assert.equal(TEMPLATE_PRESETS.trainer_trial_heads_up.category, "UTILITY");
assert.equal(TEMPLATE_PRESETS.trainer_trial_heads_up.button_text, undefined);
assert.equal(
  TEMPLATE_PRESETS.trainer_trial_heads_up.body,
  "היי, מחר מגיע אליך {{1}} לאימון ניסיון {{2}} בשעה {{3}}. כדאי להציג את עצמך ולתת חוויה טובה 🙏"
);
assert.deepEqual(paramSlotsForTriggerType("trainer_trial_heads_up"), [
  "first_name",
  "class_name",
  "class_time",
]);
assert.equal(TEMPLATE_PRESETS.class_cancelled_staff.category, "UTILITY");
assert.equal(TEMPLATE_PRESETS.class_cancelled_staff.button_text, undefined);
assert.equal(
  TEMPLATE_PRESETS.class_cancelled_staff.body,
  "שים לב - השיעור {{1}} בתאריך {{2}} בשעה {{3}} בוטל."
);
assert.deepEqual(paramSlotsForTriggerType("class_cancelled_staff"), [
  "class_name",
  "class_date",
  "class_time",
]);
assert.equal(isPresetAvailable("nth_workout", false), false);
assert.equal(isPresetAvailable("nth_workout", true), true);

assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.incoming_lead.body), 1);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.purchase.body), 2);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.membership_expiring.body), 3);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.registered_after_trial.body), 2);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.membership_cancelled.body), 2);

assert.deepEqual(paramSlotsForTriggerType("incoming_lead"), ["business_name"]);
assert.deepEqual(paramSlotsForTriggerType("site_lead"), ["business_name"]);
assert.deepEqual(paramSlotsForTriggerType("purchase"), ["first_name", "business_name"]);
assert.deepEqual(paramSlotsForTriggerType("membership_expiring"), [
  "first_name",
  "business_name",
  "expiry_date",
]);
assert.deepEqual(paramSlotsForTriggerType("membership_cancelled"), [
  "membership_type_name",
  "expiry_date",
]);

assert.equal(isPresetAvailable("incoming_lead", false), true);
assert.equal(isPresetAvailable("arbox_new_lead", false), false);
assert.equal(isPresetAvailable("arbox_new_lead", true), true);
assert.equal(isPresetAvailable("membership_cancelled", false), false);
assert.equal(isPresetAvailable("membership_cancelled", true), true);

assert.equal(isMetaTemplateContentEditable("APPROVED"), true);
assert.equal(isMetaTemplateContentEditable("rejected"), true);
assert.equal(isMetaTemplateContentEditable("PENDING"), false);
assert.equal(isMetaTemplateContentEditable("DELETED"), false);

const parsed = parseDashboardTemplateComponents([
  { type: "HEADER", format: "TEXT", text: "כותרת" },
  {
    type: "BODY",
    text: "היי {{1}}",
    example: { body_text: [["דנה"]] },
  },
  { type: "FOOTER", text: "הסטודיו" },
  {
    type: "BUTTONS",
    buttons: [{ type: "QUICK_REPLY", text: "בואו נתחיל" }],
  },
]);
assert.ok(parsed);
assert.equal(parsed.body, "היי {{1}}");
assert.equal(parsed.header, "כותרת");
assert.equal(parsed.footer, "הסטודיו");
assert.equal(parsed.buttons[0]?.kind, "QUICK_REPLY");
assert.equal(parsed.buttons[0]?.text, "בואו נתחיל");
assert.deepEqual(parsed.exampleValues, ["דנה"]);

assert.equal(
  parseDashboardTemplateComponents([{ type: "HEADER", format: "IMAGE" }]),
  null
);
assert.equal(
  parseDashboardTemplateComponents([
    { type: "BUTTONS", buttons: [{ type: "PHONE_NUMBER", text: "חייגו" }] },
  ]),
  null
);

assert.equal(uniqueTemplateName("incoming_lead", []), "incoming_lead");
assert.equal(uniqueTemplateName("incoming_lead", ["other"]), "incoming_lead");
assert.equal(uniqueTemplateName("incoming_lead", ["incoming_lead"]), "incoming_lead1");
assert.equal(
  uniqueTemplateName("incoming_lead", ["incoming_lead", "incoming_lead1"]),
  "incoming_lead2"
);
assert.equal(
  uniqueTemplateName("incoming_lead", ["incoming_lead", "incoming_lead1", "incoming_lead2"]),
  "incoming_lead3"
);
assert.equal(
  uniqueTemplateName("incoming_lead", ["incoming_lead", "incoming_lead2"]),
  "incoming_lead1"
);
assert.equal(uniqueTemplateName("incoming_lead", ["INCOMING_LEAD"]), "incoming_lead1");
assert.equal(uniqueTemplateName("birthday_wish", ["birthday_wish"]), "birthday_wish1");

console.log("template-presets.test.ts: ok");
