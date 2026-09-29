import { introAdminState, type IntroAdminState } from "@/lib/intro-offer";
import {
  PLAN_PRICE_INTRO_ILS,
  PLAN_PRICE_PRO_ILS,
  PLAN_PRICE_STARTER_ILS,
} from "@/lib/plan-prices";
import {
  PRO_MONTHLY_CONVERSATION_LIMIT,
  STARTER_MONTHLY_CONVERSATION_LIMIT,
} from "@/lib/zoe-opened-conversations";

export type AdminPackageKind = "intro" | "intro_ended" | "pro" | "starter";

export type AdminPackageView = {
  kind: AdminPackageKind;
  /** שם החבילה בדשבורד */
  label: string;
  /** הסבר קצר מתחת לשם */
  detail: string;
  /** הסכום שנגבה בפועל לחודש הנוכחי, לפני מע״מ */
  billedIls: number;
  conversationLimit: number;
  introState: IntroAdminState;
};

function finitePrice(value: unknown): number | null {
  const n = typeof value === "number" ? value : value != null && value !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isPremiumPlan(plan: string | null | undefined): boolean {
  const p = String(plan ?? "").trim().toLowerCase();
  return p === "premium" || p === "pro" || p === "intro";
}

/**
 * החבילה והסכום שנגבה בפועל.
 * חודש ראשון במבצע הוא ₪5 גם אם plan_price עדיין מחיר מחירון.
 */
export function resolveAdminPackage(input: {
  plan?: string | null;
  planPrice?: unknown;
  introPeriodEndsAt?: string | null;
  introFullPriceAt?: string | null;
  now?: Date;
}): AdminPackageView {
  const introState = introAdminState({
    introPeriodEndsAt: input.introPeriodEndsAt,
    introFullPriceAt: input.introFullPriceAt,
    now: input.now,
  });
  const price = finitePrice(input.planPrice);
  const closed = Boolean(String(input.introFullPriceAt ?? "").trim());
  const onIntroPrice = price === PLAN_PRICE_INTRO_ILS && !closed;

  if (introState === "active" || (introState === "none" && onIntroPrice)) {
    return {
      kind: "intro",
      label: "חודש ראשון",
      detail: "₪5 · יכולות Pro",
      billedIls: PLAN_PRICE_INTRO_ILS,
      conversationLimit: PRO_MONTHLY_CONVERSATION_LIMIT,
      introState,
    };
  }

  if (introState === "awaiting_full_price") {
    return {
      kind: "intro_ended",
      label: "₪5 נגמר",
      detail: "ממתין למחיר מלא",
      billedIls: PLAN_PRICE_INTRO_ILS,
      conversationLimit: PRO_MONTHLY_CONVERSATION_LIMIT,
      introState,
    };
  }

  const premium = isPremiumPlan(input.plan);
  const catalog = premium ? PLAN_PRICE_PRO_ILS : PLAN_PRICE_STARTER_ILS;
  const billed = price != null && price > 0 ? price : catalog;
  return {
    kind: premium ? "pro" : "starter",
    label: premium ? "Pro" : "Starter",
    detail: "",
    billedIls: billed,
    conversationLimit: premium ? PRO_MONTHLY_CONVERSATION_LIMIT : STARTER_MONTHLY_CONVERSATION_LIMIT,
    introState,
  };
}
