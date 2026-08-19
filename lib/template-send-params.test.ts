import assert from "node:assert/strict";
import {
  expiryYmdFromScheduledDedupKey,
  formatTemplateExpiryDate,
  resolveTemplateBodyParamValues,
  TEMPLATE_BUSINESS_NAME_FALLBACK,
  TEMPLATE_NAME_FALLBACK,
  triggerTypeFromScheduledDedupKey,
} from "@/lib/template-send-params";

{
  assert.equal(formatTemplateExpiryDate("2026-09-01"), "01.09.2026");
  assert.equal(formatTemplateExpiryDate(""), "בקרוב");
}

{
  assert.equal(
    expiryYmdFromScheduledDedupKey("membership_expiring:1:rule-uuid:99:2026-09-15"),
    "2026-09-15"
  );
  assert.equal(
    expiryYmdFromScheduledDedupKey("sessions_expiring:1:rule-uuid:99:2026-08-01:2026-09-15"),
    "2026-09-15"
  );
  assert.equal(triggerTypeFromScheduledDedupKey("site_lead:1:rule:050:2026-08-19"), "incoming_lead");
  assert.equal(triggerTypeFromScheduledDedupKey("arbox_new_lead:1:rule:9"), "arbox_new_lead");
}

{
  const hardcoded = resolveTemplateBodyParamValues({
    triggerType: "arbox_new_lead",
    storedComponents: [{ type: "BODY", text: "תודה שהתעניינתם בLimitless!" }],
    firstName: "דנה",
    businessName: "Limitless",
  });
  assert.deepEqual(hardcoded, []);
}

{
  const lead = resolveTemplateBodyParamValues({
    triggerType: "arbox_new_lead",
    storedComponents: [{ type: "BODY", text: "תודה שהתעניינתם ב{{1}}!" }],
    firstName: "דנה",
    businessName: "Limitless",
  });
  assert.deepEqual(lead, ["Limitless"]);
}

{
  const purchase = resolveTemplateBodyParamValues({
    triggerType: "purchase",
    storedComponents: [
      { type: "BODY", text: "היי {{1}}, תודה על הרכישה! איזה כיף שאתם עכשיו חלק מ{{2}}! 🎉" },
    ],
    firstName: "דנה לוי",
    businessName: "Limitless",
  });
  assert.deepEqual(purchase, ["דנה", "Limitless"]);
}

{
  const expiring = resolveTemplateBodyParamValues({
    triggerType: "membership_expiring",
    storedComponents: [
      { type: "BODY", text: "היי {{1}}, המנוי שלך ב{{2}} עומד לפוג ב-{{3}}." },
    ],
    firstName: "",
    businessName: "",
    expiryDateYmd: "2026-09-01",
  });
  assert.deepEqual(expiring, [TEMPLATE_NAME_FALLBACK, TEMPLATE_BUSINESS_NAME_FALLBACK, "01.09.2026"]);
}

{
  const missingComponents = resolveTemplateBodyParamValues({
    triggerType: "no_response",
    firstName: "יוסי",
  });
  assert.deepEqual(missingComponents, ["יוסי"]);
}

console.log("template-send-params.test.ts: ok");
