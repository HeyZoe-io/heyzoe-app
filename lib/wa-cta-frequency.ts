/**
 * 0 = full sales-flow CTA not yet sent this run (new flow / back to product pick).
 * >= 1 = full CTA already sent — follow-up free-text gets the compact register + question menu.
 */
export const FULL_SALES_FLOW_CTA_SENT_MARKER = 1;

/** @deprecated Compact follow-up replaced the every-3 full CTA resend. */
export const CTA_FREE_TEXT_REPLIES_BEFORE_RESEND = 3;

export function hasSentFullSalesFlowCta(count: number | null | undefined): boolean {
  if (count == null) return true;
  const n = Number.isFinite(count) ? Math.trunc(count) : 0;
  return n >= FULL_SALES_FLOW_CTA_SENT_MARKER;
}

/**
 * Uncapped first CTA (service pick / new flow) still sends when count is 0.
 * Free-text after that uses the compact menu instead of another full CTA session.
 */
export function shouldSendFullSalesFlowCtaMenu(count: number | null | undefined): boolean {
  return !hasSentFullSalesFlowCta(count === undefined ? 0 : count);
}

/** @deprecated Use hasSentFullSalesFlowCta — extra full CTAs are no longer resent on a 3-count. */
export function shouldSendSalesFlowCtaForFreeTextCount(count: number | null | undefined): boolean {
  if (count == null) return false;
  return shouldSendFullSalesFlowCtaMenu(count);
}
