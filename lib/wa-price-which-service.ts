import { matchesTrialTopicIntent } from "@/lib/wa-trial-topic-intent";
import {
  normalizeSalesFlowGreetingToken,
  stripLeadingCasualGreeting,
} from "@/lib/sales-flow-start-triggers";

/** גשר לפני סשן בחירת מוצר — שאלת מחיר בלי מוצר ספציפי. */
export const PRICE_WHICH_SERVICE_REPLY = "איזה אימון מעניין אותך? אגיד לך את המחיר שלו";

export const PRICE_WHICH_SERVICE_MODEL = "sales_flow_price_which_service";

const MEMBERSHIP_OR_PACK =
  /(?:מנוי(?:ות)?|כרטיסי[הא]|חבילה|membership|pack(?:age)?)/iu;

const PRICE_CUE =
  /(?:כמה\s+עולה|מה\s+המחיר|מה\s+עולה|מה\s+העלות|מחיר(?:ו|ה|ים)?|עלות|how\s+much|(?:what(?:'s|\s+is)\s+the\s+)?price)/iu;

function normalizePriceQuestionText(raw: string): string {
  return stripLeadingCasualGreeting(normalizeSalesFlowGreetingToken(raw))
    .replace(/[?!؟.،,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * שאלת מחיר לשיעור/ניסיון (או «כמה עולה?») בלי מנוי/כרטיסייה.
 * לא כולל שם מוצר — את זה בודקים מול הקטלוג בנפרד.
 */
export function matchesUnspecifiedClassPriceQuestion(raw: string): boolean {
  const t = normalizePriceQuestionText(raw);
  if (!t || t.length > 280) return false;
  if (MEMBERSHIP_OR_PACK.test(t)) return false;
  if (!PRICE_CUE.test(t)) return false;
  if (matchesTrialTopicIntent(raw)) return true;
  if (/^(?:כמה\s+עולה|מה\s+המחיר|מה\s+עולה|מה\s+העלות)\s*$/u.test(t)) return true;
  if (/(?:כמה\s+עולה|מה\s+המחיר|מה\s+עולה).{0,40}(?:שיעור|אימון|class)/iu.test(t)) return true;
  if (/(?:שיעור|אימון|class).{0,24}(?:כמה\s+עולה|מחיר|עולה)/iu.test(t)) return true;
  return false;
}

/** מרובי מוצרים, בלי התאמת קטלוג חד־משמעית, בשלב שאפשר להציג בחירת מוצר. */
export function shouldOfferServicePickForUnspecifiedPrice(input: {
  inbound: string;
  serviceCount: number;
  uniqueCatalogMatches: number;
  canOfferPick: boolean;
}): boolean {
  if (!input.canOfferPick) return false;
  if (input.serviceCount < 2) return false;
  if (input.uniqueCatalogMatches === 1) return false;
  return matchesUnspecifiedClassPriceQuestion(input.inbound);
}
