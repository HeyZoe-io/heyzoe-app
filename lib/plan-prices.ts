/** Pre-VAT monthly list prices shown on the landing page, billing, and tracking. */
export const PLAN_PRICE_STARTER_ILS = 299;
export const PLAN_PRICE_PRO_ILS = 429;

/** `starter`/`basic` → Starter, `pro`/`premium` → Pro. */
export function planPriceIls(plan: string | null | undefined): number {
  const p = String(plan ?? "").trim().toLowerCase();
  if (p === "pro" || p === "premium") return PLAN_PRICE_PRO_ILS;
  return PLAN_PRICE_STARTER_ILS;
}
