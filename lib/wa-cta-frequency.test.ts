import assert from "node:assert/strict";
import {
  hasSentFullSalesFlowCta,
  shouldSendFullSalesFlowCtaMenu,
  shouldSendSalesFlowCtaForFreeTextCount,
} from "@/lib/wa-cta-frequency";

assert.equal(hasSentFullSalesFlowCta(0), false);
assert.equal(hasSentFullSalesFlowCta(1), true);
assert.equal(hasSentFullSalesFlowCta(3), true);
assert.equal(hasSentFullSalesFlowCta(null), true);
assert.equal(hasSentFullSalesFlowCta(undefined), true);

assert.equal(shouldSendFullSalesFlowCtaMenu(0), true);
assert.equal(shouldSendFullSalesFlowCtaMenu(1), false);
assert.equal(shouldSendFullSalesFlowCtaMenu(null), false);

assert.equal(shouldSendSalesFlowCtaForFreeTextCount(0), true);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(1), false);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(null), false);

console.log("wa-cta-frequency.test.ts: ok");
