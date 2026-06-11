import type { BusinessKnowledgePack } from "@/lib/business-context";
import { detectMessageLanguage } from "@/lib/language-detect";

export type BusinessContentLanguage = "he" | "en";

function langFromSample(sample: string): BusinessContentLanguage {
  if (!sample.trim()) return "he";
  return detectMessageLanguage(sample) === "en" ? "en" : "he";
}

/** Language from welcome_intro or sales_flow.greeting_opener in social_links JSON. */
export function resolveBusinessContentLanguageFromSocialLinks(social_links?: unknown): BusinessContentLanguage {
  const sl =
    social_links && typeof social_links === "object" && !Array.isArray(social_links)
      ? (social_links as Record<string, unknown>)
      : {};
  const welcomeIntro = typeof sl.welcome_intro === "string" ? sl.welcome_intro.trim() : "";
  const rawSf = sl.sales_flow;
  const sf =
    rawSf && typeof rawSf === "object" && !Array.isArray(rawSf)
      ? (rawSf as Record<string, unknown>)
      : {};
  const greetingOpener = typeof sf.greeting_opener === "string" ? sf.greeting_opener.trim() : "";
  return langFromSample(welcomeIntro || greetingOpener);
}

export function resolveBusinessContentLanguageFromKnowledge(
  knowledge: BusinessKnowledgePack | null | undefined
): BusinessContentLanguage {
  if (!knowledge) return "he";
  const sample =
    knowledge.welcomeIntroText?.trim() || knowledge.salesFlowConfig?.greeting_opener?.trim() || "";
  return langFromSample(sample);
}

export function metaListSelectButtonLabel(lang: BusinessContentLanguage = "he"): string {
  return lang === "en" ? "Select an option" : "בחר אפשרות";
}

export function metaListSectionTitle(lang: BusinessContentLanguage = "he"): string {
  return lang === "en" ? "Options" : "אפשרויות";
}

export function metaCtaClickHereLabel(lang: BusinessContentLanguage = "he"): string {
  return lang === "en" ? "Click here" : "לחצו כאן";
}

export function metaWhatsNextBody(lang: BusinessContentLanguage = "he"): string {
  return lang === "en" ? "What's next?" : "מה הצעד הבא?";
}

export function waFollowupReplyFallbackLabel(lang: BusinessContentLanguage = "he"): string {
  return lang === "en" ? "More info please" : "אשמח לפרטים";
}

export function ctaOpenQuestionNote(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "By the way, you can also write me an open question and I'll do my best to help :)"
    : "אגב, אפשר לכתוב לי גם שאלה פתוחה ואני אענה :)";
}

export function trialSignupLinkIntro(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "Wonderful decision 🙂 Sign up right here:"
    : "איזו החלטה מדהימה 🙂 נרשמים ממש כאן:";
}

export function trialSignupLinkMissing(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "We don't have a registration link here right now. Write us a short message and we'll get back to you, or choose View schedule."
    : "כרגע אין לנו כאן קישור הרשמה - כתבו בקצרה ונחזור אליכם, או בחרו צפייה במערכת השעות.";
}

export function registeredFlowContinuationClosing(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "If there's anything else - write here and I'll be happy to help 🙂"
    : "ואם יש עוד משהו — כתבו כאן ואשמח לענות 🙂";
}

export function trialAlreadyRegisteredSoftIntro(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "You're already signed up for a trial — wonderful 🎉"
    : "כבר נרשמתם לניסיון — מעולה 🎉";
}

export function trialAlreadyRegisteredSoftClosing(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "If you have another question — just write here."
    : "ואם יש שאלה נוספת — פשוט כתבו כאן.";
}

export function trialLinkPostCtaMessage(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "After registering, please write me *I registered* and I'll send the next steps 🎉"
    : "לאחר ההרשמה, נא לכתוב לי *נרשמתי* ואשלח הוראות המשך 🎉";
}

export function secondaryOfferPurchasePostCtaMessage(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "After payment, write *I registered* and we'll send you all the details!"
    : "לאחר התשלום כתבו *נרשמתי* ואשלח לכם את כל הפרטים!";
}

export function addressOurPrefix(lang: BusinessContentLanguage): string {
  return lang === "en" ? "Our address:" : "הכתובת שלנו:";
}

export function addressDirectionsPrefix(lang: BusinessContentLanguage): string {
  return lang === "en" ? "Here's how to reach us:" : "ככה מגיעים אלינו:";
}

export function addressMissingMessage(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "The address will be updated soon. Write us and we'll send you all the details."
    : "הכתובת תתעדכן בקרוב, ונשמח לשלוח לך את כל הפרטים.";
}

export function addressMissingCtaMessage(lang: BusinessContentLanguage): string {
  return lang === "en"
    ? "The address will be updated soon. Write us and we'll send you all the details."
    : "הכתובת תתעדכן בקרוב. כתבו לנו ונשלח לכם את כל הפרטים.";
}

export function formatAddressReplyLines(
  lang: BusinessContentLanguage,
  address: string,
  directions: string
): string {
  const addr = address.trim();
  const dir = directions.trim();
  if (!addr) return addressMissingCtaMessage(lang);
  const lines = [addressOurPrefix(lang), addr];
  if (dir) lines.push(`${addressDirectionsPrefix(lang)}\n${dir}`);
  return lines.join("\n");
}

export function instagramVisitInMeantimeLine(lang: BusinessContentLanguage, url: string): string {
  const prefix =
    lang === "en"
      ? "Feel free to visit our Instagram in the meantime:"
      : "מוזמנים לבקר באינסטגרם שלנו בינתיים:";
  return `${prefix}\n${url.trim()}`;
}

export function instagramFollowLine(lang: BusinessContentLanguage, url: string): string {
  const prefix =
    lang === "en" ? "Feel free to follow us on Instagram:" : "מוזמנים לעקוב אחרינו באינסטגרם:";
  return `${prefix}\n${url.trim()}`;
}
