import assert from "node:assert/strict";
import {
  buildCompactCtaMenuLabels,
  collectSalesFlowCtaChoiceLabels,
  ctaHaveAQuestionLabel,
  ctaHaveAQuestionReply,
  inboundMatchesSalesFlowCtaChoice,
  isCtaHaveAQuestionMessage,
  pickRegistrationCtaButton,
  shouldDeferTrialTopicToCtaHandler,
} from "@/lib/wa-cta-compact";
import { hasSentFullSalesFlowCta, shouldSendFullSalesFlowCtaMenu } from "@/lib/wa-cta-frequency";
import type { SalesFlowCtaButton, SalesFlowConfig } from "@/lib/sales-flow";

assert.equal(isCtaHaveAQuestionMessage("יש לי שאלה"), true);
assert.equal(isCtaHaveAQuestionMessage("יש לי  שאלה"), true);
assert.equal(isCtaHaveAQuestionMessage("I have a question"), true);
assert.equal(isCtaHaveAQuestionMessage("מה ללבוש?"), false);
assert.equal(isCtaHaveAQuestionMessage("אפשר להקפיא?"), false);
assert.equal(ctaHaveAQuestionReply("he"), "בשמחה, מה השאלה?");
assert.equal(ctaHaveAQuestionLabel("he"), "יש לי שאלה");

const trialBtns: SalesFlowCtaButton[] = [
  { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial" },
  { id: "cta-schedule", label: "צפייה במערכת השעות", kind: "schedule" },
  { id: "cta-mem", label: "מחירי מנויים", kind: "memberships" },
];
assert.equal(pickRegistrationCtaButton(trialBtns)?.label, "הרשמה לשיעור ניסיון");
assert.deepEqual(buildCompactCtaMenuLabels(trialBtns, "he"), [
  "הרשמה לשיעור ניסיון",
  "יש לי שאלה",
]);

const courseBtns: SalesFlowCtaButton[] = [
  { id: "cta-enroll", label: "להרשמה לקורס", kind: "course_enroll" },
  { id: "cta-contact", label: "יצירת קשר", kind: "course_contact" },
];
assert.equal(pickRegistrationCtaButton(courseBtns)?.kind, "course_enroll");

assert.equal(hasSentFullSalesFlowCta(0), false);
assert.equal(hasSentFullSalesFlowCta(1), true);
assert.equal(hasSentFullSalesFlowCta(null), false);
assert.equal(shouldSendFullSalesFlowCtaMenu(0), true);
assert.equal(shouldSendFullSalesFlowCtaMenu(1), false);

const limitlessCfg = {
  cta_buttons: trialBtns,
  cta_workshop_buttons: [],
  cta_course_buttons: [],
  followup_after_next_class_options: [
    "הרשמה לשיעור ניסיון",
    "צפייה במערכת השעות",
    "מחירי מנויים",
  ],
} as Pick<
  SalesFlowConfig,
  "cta_buttons" | "cta_workshop_buttons" | "cta_course_buttons" | "followup_after_next_class_options"
>;
const ctaLabels = collectSalesFlowCtaChoiceLabels(limitlessCfg, "he");
assert.equal(inboundMatchesSalesFlowCtaChoice("הרשמה לשיעור ניסיון", ctaLabels), true);
assert.equal(inboundMatchesSalesFlowCtaChoice("מה זה אימון ניסיון?", ctaLabels), false);
assert.equal(
  shouldDeferTrialTopicToCtaHandler({
    inbound: "הרשמה לשיעור ניסיון",
    sessionPhase: "cta",
    lastAssistantModel: "sales_flow_cta_compact",
    ctaLabels,
  }),
  true,
  "CTA click at compact menu must send the trial link, not trial FAQ"
);
assert.equal(
  shouldDeferTrialTopicToCtaHandler({
    inbound: "מה זה אימון ניסיון?",
    sessionPhase: "cta",
    lastAssistantModel: "sales_flow_cta_compact",
    ctaLabels,
  }),
  false,
  "open trial FAQ at CTA still uses trial-topic Q&A"
);
assert.equal(
  shouldDeferTrialTopicToCtaHandler({
    inbound: "הרשמה לשיעור ניסיון",
    sessionPhase: "opening",
    lastAssistantModel: "greeting",
    ctaLabels,
  }),
  false,
  "same label out of CTA still goes to trial-topic / flow-entry"
);

console.log("wa-cta-compact.test.ts: ok");
