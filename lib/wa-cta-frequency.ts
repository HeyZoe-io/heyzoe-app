/**
 * contacts.free_text_replies_since_cta is a 0/1 flag (name is historical):
 * 0 = full sales-flow CTA not yet sent this run (new flow / product pick / switch).
 * >= 1 = full CTA already sent — later answers get compact register + question buttons.
 */
export const FULL_SALES_FLOW_CTA_SENT_MARKER = 1;

export type SalesFlowCtaDeliveryMode = "full" | "compact";

export function hasSentFullSalesFlowCta(count: number | null | undefined): boolean {
  if (count == null) return true;
  const n = Number.isFinite(count) ? Math.trunc(count) : 0;
  return n >= FULL_SALES_FLOW_CTA_SENT_MARKER;
}

/** Shared full-vs-compact decision for every CTA send path. null (unreadable) → compact (fail closed). */
export function resolveSalesFlowCtaDeliveryMode(
  fullCtaAlreadySentFlag: number | null | undefined
): SalesFlowCtaDeliveryMode {
  return hasSentFullSalesFlowCta(fullCtaAlreadySentFlag) ? "compact" : "full";
}

export function shouldSendFullSalesFlowCtaMenu(count: number | null | undefined): boolean {
  return resolveSalesFlowCtaDeliveryMode(count === undefined ? 0 : count) === "full";
}

/** @deprecated Use resolveSalesFlowCtaDeliveryMode. */
export function shouldSendSalesFlowCtaForFreeTextCount(count: number | null | undefined): boolean {
  if (count == null) return false;
  return shouldSendFullSalesFlowCtaMenu(count);
}
