export const META_PRICING_NOTICE_KEY = "meta_pricing_2026_10";

export const META_RATES_IL = {
  effectiveFrom: "2026-10-01",
  currency: "USD",
  usdIlsRate: 3.03, // as of 2026-09-14
  marketing: 0.0353,
  utility: 0.0053,
  authentication: 0.0053,
  service: 0.0053,
} as const;

/** USD-per-message rate -> agorot (1 ILS = 100 agorot), rounded to 1 decimal. */
export function usdRateToAgorot(usdRate: number): number {
  return Math.round(usdRate * META_RATES_IL.usdIlsRate * 100 * 10) / 10;
}

/** Agorot value formatted for Hebrew copy, e.g. 1.6 or 10.7. */
export function formatAgorot(agorot: number): string {
  return agorot % 1 === 0 ? String(agorot) : agorot.toFixed(1);
}

/** USD-per-message rate -> ILS, formatted to 3 decimals for Hebrew copy, e.g. "0.016" or "0.107". */
export function usdRateToIls(usdRate: number): string {
  return (usdRate * META_RATES_IL.usdIlsRate).toFixed(3);
}

export const META_MONTHLY_EXAMPLE = {
  conversationsPerMonth: 200,
  messagesPerConversation: 8,
} as const;

export function metaMonthlyExampleMessages(): number {
  return META_MONTHLY_EXAMPLE.conversationsPerMonth * META_MONTHLY_EXAMPLE.messagesPerConversation;
}

/** Monthly ILS cost for the 200-conversation / 8-message example, rounded to the nearest shekel. */
export function metaMonthlyExampleIls(): number {
  const totalMessages = metaMonthlyExampleMessages();
  const totalUsd = totalMessages * META_RATES_IL.service;
  return Math.round(totalUsd * META_RATES_IL.usdIlsRate);
}
