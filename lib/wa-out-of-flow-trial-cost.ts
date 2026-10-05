import { detectMessageLanguage } from "@/lib/language-detect";
import { matchesTrialTopicAdvanceIntent } from "@/lib/wa-trial-topic-intent";
import { matchesUnspecifiedClassPriceQuestion } from "@/lib/wa-price-which-service";

/** אחרי מחיר, מחוץ לפלואו — הכתיבה הזו פותחת את פלואו המכירה. */
export const OUT_OF_FLOW_TRIAL_COST_INVITE_HE =
  "לפרטים נוספים אפשר לכתוב לי ״אשמח לפרטים״ ואספר לך הכל!";

export const OUT_OF_FLOW_TRIAL_COST_MODEL = "out_of_flow_trial_cost";

const YOUTH_RE = /ילד|נוער/u;
const FREE_PRICE_RE = /^(?:0|ללא\s*עלות|חינם|free)$/iu;

export type TrialCostService = {
  name?: string | null;
  priceText?: string | null;
  offerKind?: string | null;
};

/**
 * שאלת עלות על אימון/שיעור ניסיון לפני שנכנסים לפלואו.
 * «רוצה להירשם» נשאר פתיחת פלואו.
 */
export function isOutOfFlowTrialCostQuestion(raw: string): boolean {
  if (!matchesUnspecifiedClassPriceQuestion(raw)) return false;
  if (matchesTrialTopicAdvanceIntent(raw)) return false;
  return true;
}

function paidAmount(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!t || FREE_PRICE_RE.test(t)) return null;
  const n = Number(t.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function servicesForQuestion(services: TrialCostService[], inbound: string): TrialCostService[] {
  const trials = services.filter((s) => {
    const kind = String(s.offerKind ?? "trial").trim().toLowerCase();
    return kind === "trial" || kind === "";
  });
  if (YOUTH_RE.test(inbound)) {
    const youth = trials.filter((s) => YOUTH_RE.test(String(s.name ?? "")));
    if (youth.length) return youth;
  }
  const adult = trials.filter((s) => !YOUTH_RE.test(String(s.name ?? "")));
  return adult.length ? adult : trials;
}

/** תווית מחיר לליד: «45 ₪», «80–120 ₪», או «ללא עלות». ריק אם אין מחיר. */
export function trialCostLabelForQuestion(services: TrialCostService[], inbound: string): string {
  const rows = servicesForQuestion(services, inbound);
  const prices = rows.map((s) => String(s.priceText ?? "").trim()).filter(Boolean);
  if (!prices.length) return "";

  const amounts = prices
    .map((p) => paidAmount(p))
    .filter((n): n is number => n != null);
  if (!amounts.length) {
    return prices.some((p) => FREE_PRICE_RE.test(p)) ? "ללא עלות" : "";
  }
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min === max) return `${min} ₪`;
  return `${min}–${max} ₪`;
}

function costSentence(label: string, lang: "he" | "en" | "ru"): string {
  const free = label === "ללא עלות";
  if (lang === "en") {
    return free ? "The intro class is free." : `An intro class costs ${label}.`;
  }
  if (lang === "ru") {
    return free ? "Пробная тренировка бесплатная." : `Пробная тренировка стоит ${label}.`;
  }
  return free ? "אימון היכרות ללא עלות." : `אימון היכרות עולה ${label}.`;
}

function inviteSentence(lang: "he" | "en" | "ru"): string {
  if (lang === "en") {
    return 'For more details, write me "I\'d like details" and I\'ll tell you everything!';
  }
  if (lang === "ru") {
    return "Чтобы узнать больше, напиши мне «хочу подробности» — и я всё расскажу!";
  }
  return OUT_OF_FLOW_TRIAL_COST_INVITE_HE;
}

/** null = אין מחיר בקטלוג, לא ממציאים סכום. */
export function buildOutOfFlowTrialCostReply(
  services: TrialCostService[],
  inbound: string
): string | null {
  const label = trialCostLabelForQuestion(services, inbound);
  if (!label) return null;
  const detected = detectMessageLanguage(inbound);
  const lang = detected === "en" || detected === "ru" ? detected : "he";
  return `${costSentence(label, lang)}\n${inviteSentence(lang)}`;
}
