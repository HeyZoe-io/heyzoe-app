import assert from "node:assert/strict";
import {
  hasSentFullSalesFlowCta,
  resolveSalesFlowCtaDeliveryMode,
  shouldSendFullSalesFlowCtaMenu,
  shouldSendSalesFlowCtaForFreeTextCount,
} from "@/lib/wa-cta-frequency";
import { salesFlowOpeningResetPatch, salesFlowServiceSwitchResetPatch } from "@/lib/wa-warmup-awaiting-idx";

assert.equal(hasSentFullSalesFlowCta(0), false);
assert.equal(hasSentFullSalesFlowCta(1), true);
assert.equal(hasSentFullSalesFlowCta(3), true);
assert.equal(hasSentFullSalesFlowCta(null), true);
assert.equal(hasSentFullSalesFlowCta(undefined), true);

assert.equal(resolveSalesFlowCtaDeliveryMode(0), "full");
assert.equal(resolveSalesFlowCtaDeliveryMode(1), "compact");
assert.equal(resolveSalesFlowCtaDeliveryMode(null), "compact");

assert.equal(shouldSendFullSalesFlowCtaMenu(0), true);
assert.equal(shouldSendFullSalesFlowCtaMenu(1), false);
assert.equal(shouldSendFullSalesFlowCtaMenu(null), false);

assert.equal(shouldSendSalesFlowCtaForFreeTextCount(0), true);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(1), false);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(null), false);

// Scenario 1: new flow / product pick → full once; later open question → compact.
assert.equal(resolveSalesFlowCtaDeliveryMode(0), "full");
assert.equal(resolveSalesFlowCtaDeliveryMode(1), "compact");

// Scenario 2: implicit switch (bare product name) resets flag → exactly one full resend.
const implicitPatch = salesFlowServiceSwitchResetPatch("cta");
assert.equal(implicitPatch.free_text_replies_since_cta, 0);
assert.equal(implicitPatch.session_phase, "cta");
assert.equal(salesFlowOpeningResetPatch().free_text_replies_since_cta, 0);
assert.equal(resolveSalesFlowCtaDeliveryMode(implicitPatch.free_text_replies_since_cta), "full");

// Scenario 3: sf_recover_to_cta must use the same helper (flag 1 → compact, not unconditional full).
assert.equal(resolveSalesFlowCtaDeliveryMode(1), "compact");
assert.notEqual(resolveSalesFlowCtaDeliveryMode(1), "full");

// Limitless-style implicit switch (bare catalog name) uses the same reset patch as Joe.
const limitlessSwitch = salesFlowServiceSwitchResetPatch("schedule_date");
assert.equal(limitlessSwitch.free_text_replies_since_cta, 0);
assert.equal(resolveSalesFlowCtaDeliveryMode(limitlessSwitch.free_text_replies_since_cta), "full");

console.log("wa-cta-frequency.test.ts: ok");
