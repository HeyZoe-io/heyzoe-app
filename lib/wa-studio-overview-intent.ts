import { detectMessageLanguage, type DetectedMessageLanguage } from "@/lib/language-detect";
import { isAddressOrDirectionsIntent } from "@/lib/wa-address-intent";
import { isScheduleIntent } from "@/lib/wa-schedule-intent";
import {
  isSalesFlowStartTrigger,
  normalizeSalesFlowGreetingToken,
  stripLeadingCasualGreeting,
} from "@/lib/sales-flow-start-triggers";
import { matchesTrialTopicIntent } from "@/lib/wa-trial-topic-intent";
import { isJoinSignupIntentText } from "@/lib/wa-warmup-skip-intent";

export const STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE = "נשמח שתהיו חלק מהקהילה שלנו!";
export const STUDIO_OVERVIEW_COMMUNITY_CLOSING_EN = "We'd love for you to be part of our community!";

export function studioOverviewCommunityClosing(lang: DetectedMessageLanguage): string {
  return lang === "en" ? STUDIO_OVERVIEW_COMMUNITY_CLOSING_EN : STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE;
}

function hasPriceAsk(t: string): boolean {
  return (
    /(?:כמה\s+עולה|מה\s+המחיר|מה\s+העלות|how much|what(?:s| is) the price|\bpricing\b)/u.test(t)
  );
}

/** בקשת פרטים על הסטודיו בלי להיכנס לפלואו מכירה. */
export function isStudioOverviewIntentText(raw: string): boolean {
  if (isSalesFlowStartTrigger(raw)) return false;
  if (isAddressOrDirectionsIntent(raw)) return false;
  if (isScheduleIntent(raw)) return false;
  if (matchesTrialTopicIntent(raw)) return false;
  if (isJoinSignupIntentText(raw)) return false;

  const normalized = normalizeSalesFlowGreetingToken(raw);
  const t = stripLeadingCasualGreeting(normalized);
  if (!t || t.length > 400) return false;
  if (hasPriceAsk(t)) return false;

  if (
    /על\s+(?:ה)?סטודיו/.test(t) ||
    /על\s+(?:ה)?מקום/.test(t) ||
    /על\s+(?:ה)?עסק/.test(t) ||
    /קצת\s+על\s+(?:ה)?(?:סטודיו|מקום|עסק)/.test(t) ||
    /פרטים\s+על\s+(?:ה)?(?:סטודיו|מקום|עסק)/.test(t) ||
    /לשמוע\s+על\s+(?:ה)?(?:סטודיו|מקום|עסק)/.test(t) ||
    /מה\s+זה\s+(?:ה)?(?:סטודיו|מקום)/.test(t) ||
    /מי\s+את(?:ם|ן)$/.test(t) ||
    /מי\s+את(?:ם|ן)\s/.test(t) ||
    /מה\s+המקום(?:\s+הזה)?/.test(t) ||
    /מה\s+יש\s+אצל(?:כם|כן)/.test(t) ||
    /מה\s+יש\s+ל(?:כם|כן)/.test(t) ||
    /מה\s+את(?:ם|ן)\s+מציע(?:ים|ות)/.test(t) ||
    /מה\s+מציעים/.test(t) ||
    /מה\s+את(?:ם|ן)\s+עוש(?:ים|ות)/.test(t) ||
    /רוצה\s+לשמוע\s+עלי(?:כם|כן)/.test(t) ||
    /רוצה\s+לדעת\s+עלי(?:כם|כן)/.test(t) ||
    /(?:ספר(?:י|ו)?|תספר(?:י)?)\s+(?:לי\s+)?על/.test(t) ||
    /תוכל(?:י)?\s+לספר/.test(t) ||
    /ספר(?:י|ו)\s+קצת/.test(t) ||
    /איזה\s+(?:שיעורים|אימונים)\s+יש/.test(t) ||
    /רוצה\s+לשמוע\s+על\s+האפשרויות/.test(t) ||
    /^מה\s+האפשרויות$/.test(t) ||
    /^רק\s+(?:רוצה\s+)?(?:לדעת\s+)?פרטים$/.test(t) ||
    /^אפשר\s+לקבל\s+פרטים$/.test(t)
  ) {
    return true;
  }

  if (
    /tell me about (?:the )?(?:studio|place|business)/.test(t) ||
    /about the studio/.test(t) ||
    /what do you (?:guys )?offer/.test(t) ||
    /what kind of (?:studio|place)/.test(t) ||
    /what is this (?:studio|place)/.test(t) ||
    /what classes do you have/.test(t) ||
    /just want (?:some )?details/.test(t)
  ) {
    return true;
  }

  return false;
}

export function studioOverviewClosingForInbound(inbound: string): string {
  return studioOverviewCommunityClosing(detectMessageLanguage(inbound));
}
