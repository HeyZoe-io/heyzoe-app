/** Max one sales-flow CTA menu per this many Claude free-text replies. */
export const CTA_FREE_TEXT_REPLIES_BEFORE_RESEND = 3;

/**
 * Send CTA when count is 0 (first / just reset) or >= 3 (after 3 AI replies).
 * Skip when 1 or 2 — otherwise the first CTA after service-pick (count 0) is blocked.
 */
export function shouldSendSalesFlowCtaForFreeTextCount(count: number): boolean {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return n === 0 || n >= CTA_FREE_TEXT_REPLIES_BEFORE_RESEND;
}
