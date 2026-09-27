/** Pre-VAT monthly list prices shown on the landing page, billing, and tracking. */
export const PLAN_PRICE_STARTER_ILS = 299;
export const PLAN_PRICE_PRO_ILS = 429;
/** First charge only. After that iCount is updated to 299 or 429 — not a lifetime price. */
export const PLAN_PRICE_INTRO_ILS = 5;

export type CheckoutPlan = "starter" | "pro" | "intro";

export function normalizeCheckoutPlan(plan: string | null | undefined): CheckoutPlan {
  const p = String(plan ?? "").trim().toLowerCase();
  if (p === "pro" || p === "premium") return "pro";
  if (p === "intro") return "intro";
  return "starter";
}

/** intro is the first-month offer and still receives Pro capabilities. */
export function checkoutPlanGrantsPremium(plan: string | null | undefined): boolean {
  const p = normalizeCheckoutPlan(plan);
  return p === "pro" || p === "intro";
}

export function businessPlanFromCheckout(plan: string | null | undefined): "premium" | "basic" {
  return checkoutPlanGrantsPremium(plan) ? "premium" : "basic";
}

/** Charged amount now (pre-VAT). `intro` is ₪5 for the first month only. */
export function planPriceIls(plan: string | null | undefined): number {
  const p = String(plan ?? "").trim().toLowerCase();
  if (p === "intro") return PLAN_PRICE_INTRO_ILS;
  if (p === "pro" || p === "premium") return PLAN_PRICE_PRO_ILS;
  return PLAN_PRICE_STARTER_ILS;
}
