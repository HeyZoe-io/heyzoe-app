import assert from "node:assert/strict";
import { shouldSendSalesFlowCtaForFreeTextCount } from "@/lib/wa-cta-frequency";

assert.equal(shouldSendSalesFlowCtaForFreeTextCount(0), true);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(1), false);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(2), false);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(3), true);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(4), true);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(-1), true);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(Number.NaN), true);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(null), false);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(undefined), false);

console.log("wa-cta-frequency.test.ts: ok");
