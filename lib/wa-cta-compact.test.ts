import assert from "node:assert/strict";
import {
  buildCompactCtaMenuLabels,
  ctaHaveAQuestionLabel,
  ctaHaveAQuestionReply,
  isCtaHaveAQuestionMessage,
  pickRegistrationCtaButton,
} from "@/lib/wa-cta-compact";
import { hasSentFullSalesFlowCta, shouldSendFullSalesFlowCtaMenu } from "@/lib/wa-cta-frequency";
import type { SalesFlowCtaButton } from "@/lib/sales-flow";

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

console.log("wa-cta-compact.test.ts: ok");
