import { businessPlanFromCheckout, PLAN_PRICE_INTRO_ILS, planPriceIls } from "@/lib/plan-prices";

/** מייל לאדמין נשלח כשנשארו לכל היותר כך ימים עד סוף חודש ה-₪5. */
export const INTRO_REMINDER_LEAD_MS = 3 * 24 * 60 * 60 * 1000;
/** אם הקרוון פספס את היום, עדיין שולחים עד יום אחרי הסיום. */
export const INTRO_REMINDER_LATE_MS = 24 * 60 * 60 * 1000;

export type IntroAdminState = "active" | "awaiting_full_price" | "none";

export function introPeriodEndsAt(paidAt: Date): Date {
  const ends = new Date(paidAt.getTime());
  const day = ends.getUTCDate();
  ends.setUTCMonth(ends.getUTCMonth() + 1);
  if (ends.getUTCDate() !== day) ends.setUTCDate(0);
  return ends;
}

export function formatIsraelDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function introAdminState(input: {
  introPeriodEndsAt?: string | null;
  introFullPriceAt?: string | null;
  now?: Date;
}): IntroAdminState {
  const endsRaw = String(input.introPeriodEndsAt ?? "").trim();
  if (!endsRaw) return "none";
  if (String(input.introFullPriceAt ?? "").trim()) return "none";
  const ends = new Date(endsRaw);
  if (Number.isNaN(ends.getTime())) return "none";
  const now = input.now ?? new Date();
  return now.getTime() < ends.getTime() ? "active" : "awaiting_full_price";
}

export function introReminderIsDue(input: {
  introPeriodEndsAt?: string | null;
  introReminderSentAt?: string | null;
  introFullPriceAt?: string | null;
  now?: Date;
}): boolean {
  if (introAdminState(input) === "none") return false;
  if (String(input.introReminderSentAt ?? "").trim()) return false;
  const ends = new Date(String(input.introPeriodEndsAt));
  const now = input.now ?? new Date();
  const untilEnd = ends.getTime() - now.getTime();
  return untilEnd <= INTRO_REMINDER_LEAD_MS && untilEnd > -INTRO_REMINDER_LATE_MS;
}

export type IntroPaymentPatch = {
  /** false = חיוב חוזר של אותו מבצע. לא לדרוס plan / plan_price / תאריך הסיום. */
  applyCatalogPrice: boolean;
  plan?: "premium" | "basic";
  plan_price?: number;
  intro_period_ends_at?: string;
  intro_full_price_at?: string;
};

/**
 * איך לעדכן עסק קיים לפי מרקר התשלום.
 * חיוב חוזר עם custom=intro לא מאפס את החודש ולא מחזיר מחיר ₪5 אחרי מעבר למחיר מלא.
 */
export function introPaymentPatch(input: {
  marker: string | null | undefined;
  paidAt?: Date;
  existingIntroEndsAt?: string | null;
  existingIntroFullPriceAt?: string | null;
}): IntroPaymentPatch {
  const raw = String(input.marker ?? "").trim().toLowerCase();
  const isIntro = raw === "intro";
  const paidAt = input.paidAt ?? new Date();
  const alreadyTracking = Boolean(String(input.existingIntroEndsAt ?? "").trim());
  const alreadyClosed = Boolean(String(input.existingIntroFullPriceAt ?? "").trim());

  if (isIntro && alreadyTracking) {
    return { applyCatalogPrice: false };
  }
  if (isIntro) {
    return {
      applyCatalogPrice: true,
      plan: "premium",
      plan_price: PLAN_PRICE_INTRO_ILS,
      intro_period_ends_at: introPeriodEndsAt(paidAt).toISOString(),
    };
  }

  const plan = businessPlanFromCheckout(raw);
  const plan_price = planPriceIls(raw);
  if (alreadyTracking && !alreadyClosed) {
    return {
      applyCatalogPrice: true,
      plan,
      plan_price,
      intro_full_price_at: paidAt.toISOString(),
    };
  }
  return { applyCatalogPrice: true, plan, plan_price };
}
