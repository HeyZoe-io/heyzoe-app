/**
 * contacts.free_text_replies_since_cta is a 0/1 flag (name is historical).
 * Column is `smallint not null default 0` — new rows get 0, not SQL NULL.
 * 0 / null / undefined = full CTA not yet sent this run.
 * >= 1 = full CTA already sent — later answers get compact register + question buttons.
 */
export const FULL_SALES_FLOW_CTA_SENT_MARKER = 1;

export type SalesFlowCtaDeliveryMode = "full" | "compact";

/** Result of reading the flag from contacts — keep unread-failure out of the null "never sent" case. */
export type SalesFlowCtaFlagRead =
  | { status: "ok"; value: number | null }
  | { status: "unreadable"; error?: string };

/** Stored flag: SQL NULL / missing → null (never sent). Finite numbers are truncated. */
export function parseSalesFlowCtaFlagValue(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

export function hasSentFullSalesFlowCta(count: number | null | undefined): boolean {
  if (count == null) return false;
  const n = Number.isFinite(count) ? Math.trunc(count) : 0;
  return n >= FULL_SALES_FLOW_CTA_SENT_MARKER;
}

/**
 * Shared full-vs-compact decision for a stored flag value.
 * `null` / `undefined` = never set → full (first CTA).
 * Unreadable DB reads must NOT be passed here — use {@link resolveSalesFlowCtaDeliveryFromRead}.
 */
export function resolveSalesFlowCtaDeliveryMode(
  fullCtaAlreadySentFlag: number | null | undefined
): SalesFlowCtaDeliveryMode {
  return hasSentFullSalesFlowCta(fullCtaAlreadySentFlag) ? "compact" : "full";
}

/** Fail-closed to compact only when the column cannot be read. Logs at the call site. */
export function resolveSalesFlowCtaDeliveryFromRead(read: SalesFlowCtaFlagRead): SalesFlowCtaDeliveryMode {
  if (read.status === "unreadable") return "compact";
  return resolveSalesFlowCtaDeliveryMode(read.value);
}

export function shouldSendFullSalesFlowCtaMenu(count: number | null | undefined): boolean {
  return resolveSalesFlowCtaDeliveryMode(count) === "full";
}

/** @deprecated Use resolveSalesFlowCtaDeliveryMode. */
export function shouldSendSalesFlowCtaForFreeTextCount(count: number | null | undefined): boolean {
  return shouldSendFullSalesFlowCtaMenu(count);
}
