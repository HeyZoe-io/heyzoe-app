import assert from "node:assert/strict";
import {
  hasSentFullSalesFlowCta,
  parseSalesFlowCtaFlagValue,
  resolveSalesFlowCtaDeliveryFromRead,
  resolveSalesFlowCtaDeliveryMode,
  shouldSendFullSalesFlowCtaMenu,
  shouldSendSalesFlowCtaForFreeTextCount,
} from "@/lib/wa-cta-frequency";
import { salesFlowOpeningResetPatch, salesFlowServiceSwitchResetPatch } from "@/lib/wa-warmup-awaiting-idx";

assert.equal(hasSentFullSalesFlowCta(0), false);
assert.equal(hasSentFullSalesFlowCta(1), true);
assert.equal(hasSentFullSalesFlowCta(3), true);
assert.equal(hasSentFullSalesFlowCta(null), false);
assert.equal(hasSentFullSalesFlowCta(undefined), false);

assert.equal(resolveSalesFlowCtaDeliveryMode(0), "full");
assert.equal(resolveSalesFlowCtaDeliveryMode(1), "compact");
// True never-set (SQL NULL / untouched) must get the full session, not compact.
assert.equal(resolveSalesFlowCtaDeliveryMode(null), "full");
assert.equal(resolveSalesFlowCtaDeliveryMode(undefined), "full");

assert.equal(shouldSendFullSalesFlowCtaMenu(0), true);
assert.equal(shouldSendFullSalesFlowCtaMenu(1), false);
assert.equal(shouldSendFullSalesFlowCtaMenu(null), true);

assert.equal(shouldSendSalesFlowCtaForFreeTextCount(0), true);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(1), false);
assert.equal(shouldSendSalesFlowCtaForFreeTextCount(null), true);

assert.equal(parseSalesFlowCtaFlagValue(null), null);
assert.equal(parseSalesFlowCtaFlagValue(undefined), null);
assert.equal(parseSalesFlowCtaFlagValue(0), 0);
assert.equal(parseSalesFlowCtaFlagValue(1), 1);

assert.equal(resolveSalesFlowCtaDeliveryFromRead({ status: "ok", value: null }), "full");
assert.equal(resolveSalesFlowCtaDeliveryFromRead({ status: "ok", value: 0 }), "full");
assert.equal(resolveSalesFlowCtaDeliveryFromRead({ status: "ok", value: 1 }), "compact");
assert.equal(resolveSalesFlowCtaDeliveryFromRead({ status: "unreadable" }), "compact");

// First CTA-eligible send for a contact whose flag was never written (true null, not 0).
function firstCtaEligibleSendMode(read: Parameters<typeof resolveSalesFlowCtaDeliveryFromRead>[0]) {
  return resolveSalesFlowCtaDeliveryFromRead(read);
}
assert.equal(firstCtaEligibleSendMode({ status: "ok", value: parseSalesFlowCtaFlagValue(null) }), "full");
assert.equal(firstCtaEligibleSendMode({ status: "ok", value: parseSalesFlowCtaFlagValue(0) }), "full");
assert.equal(firstCtaEligibleSendMode({ status: "ok", value: parseSalesFlowCtaFlagValue(1) }), "compact");
assert.equal(firstCtaEligibleSendMode({ status: "unreadable", error: "select failed" }), "compact");

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
