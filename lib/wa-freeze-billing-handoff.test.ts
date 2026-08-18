import assert from "node:assert/strict";
import {
  isFreezeBillingAccountDispute,
  FREEZE_BILLING_HANDOFF_REPLY,
} from "@/lib/wa-freeze-billing-handoff";

const liveLead = `היוש
חזרתי לארץ ובאתי להרשם וזה עבד לי
אני מנסה להבין אם זה כי לא הקפאתם לי את המנוי כי עכשיו גם ראיתי שירד לי תשלום על החמישה שבועות שביקשתי בהם הקפאה`;

assert.equal(isFreezeBillingAccountDispute(liveLead), true);
assert.equal(isFreezeBillingAccountDispute("ביקשתי הקפאה ועדיין ירד לי תשלום"), true);
assert.equal(isFreezeBillingAccountDispute("לא הקפאתם לי את המנוי"), true);
assert.equal(isFreezeBillingAccountDispute("הקפאתי מנוי וירד לי תשלום"), true);
assert.equal(isFreezeBillingAccountDispute("אפשר להקפיא את המנוי?"), false);
assert.equal(isFreezeBillingAccountDispute("מה מדיניות ההקפאה?"), false);
assert.equal(isFreezeBillingAccountDispute("יש תשלום על הקפאה?"), false);
assert.equal(isFreezeBillingAccountDispute("מתי השיעור?"), false);
assert.match(FREEZE_BILLING_HANDOFF_REPLY, /מעבירה את זה לבדיקה מול הצוות/);
assert.doesNotMatch(FREEZE_BILLING_HANDOFF_REPLY, /בדיוק משהו|על פי מה שביקשת|הסברים מדויקים/);

console.log("wa-freeze-billing-handoff.test.ts: ok");
