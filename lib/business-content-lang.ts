import type { BusinessKnowledgePack } from "@/lib/business-context";
import { detectMessageLanguage } from "@/lib/language-detect";
import {
  SALES_FLOW_START_BUTTON_LABEL_EN,
  SALES_FLOW_START_BUTTON_LABEL_HE,
  SALES_FLOW_START_BUTTON_LABEL_RU,
} from "@/lib/sales-flow-start-triggers";

export type BusinessContentLanguage = "he" | "en" | "ru";

export function pickContentCopy(
  lang: BusinessContentLanguage | undefined,
  copies: { he: string; en: string; ru: string }
): string {
  if (lang === "en") return copies.en;
  if (lang === "ru") return copies.ru;
  return copies.he;
}

function langFromSample(sample: string): BusinessContentLanguage {
  if (!sample.trim()) return "he";
  const detected = detectMessageLanguage(sample);
  if (detected === "en" || detected === "ru") return detected;
  return "he";
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
  if (knowledge.leadUiLang === "he" || knowledge.leadUiLang === "en" || knowledge.leadUiLang === "ru") {
    return knowledge.leadUiLang;
  }
  const sample =
    knowledge.welcomeIntroText?.trim() || knowledge.salesFlowConfig?.greeting_opener?.trim() || "";
  return langFromSample(sample);
}

export function metaListSelectButtonLabel(lang: BusinessContentLanguage = "he"): string {
  return pickContentCopy(lang, {
    he: "בחר אפשרות",
    en: "Select an option",
    ru: "Выбрать",
  });
}

export function metaListSectionTitle(lang: BusinessContentLanguage = "he"): string {
  return pickContentCopy(lang, {
    he: "אפשרויות",
    en: "Options",
    ru: "Варианты",
  });
}

export function metaCtaClickHereLabel(lang: BusinessContentLanguage = "he"): string {
  return pickContentCopy(lang, {
    he: "לחצו כאן",
    en: "Click here",
    ru: "Нажмите здесь",
  });
}

export function metaWhatsNextBody(lang: BusinessContentLanguage = "he"): string {
  return pickContentCopy(lang, {
    he: "מה הצעד הבא?",
    en: "What's next?",
    ru: "Что дальше?",
  });
}

export function waFollowupReplyFallbackLabel(lang: BusinessContentLanguage = "he"): string {
  return pickContentCopy(lang, {
    he: SALES_FLOW_START_BUTTON_LABEL_HE,
    en: SALES_FLOW_START_BUTTON_LABEL_EN.replace(/!$/, ""),
    ru: SALES_FLOW_START_BUTTON_LABEL_RU,
  });
}

export function ctaOpenQuestionNote(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "אגב, אפשר לכתוב לי גם שאלה פתוחה ואני אענה :)",
    en: "By the way, you can also write me an open question and I'll do my best to help :)",
    ru: "Кстати, можно написать мне и открытый вопрос — я постараюсь помочь :)",
  });
}

export function trialSignupLinkIntro(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "איזו החלטה מדהימה 🙂 נרשמים ממש כאן:",
    en: "Wonderful decision 🙂 Sign up right here:",
    ru: "Отличное решение 🙂 Записаться можно прямо здесь:",
  });
}

export function matchedClassSignupLinkIntro(lang: BusinessContentLanguage, serviceName: string): string {
  const name = String(serviceName ?? "").trim();
  const intro = trialSignupLinkIntro(lang);
  if (!name) return intro;
  const prefix = pickContentCopy(lang, {
    he: `זה ${name} 💜`,
    en: `That's ${name} 💜`,
    ru: `Это ${name} 💜`,
  });
  return `${prefix}\n${intro}`;
}

export function trialSignupLinkMissing(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "כרגע אין לנו כאן קישור הרשמה - כתבו בקצרה ונחזור אליכם, או בחרו צפייה במערכת השעות.",
    en: "We don't have a registration link here right now. Write us a short message and we'll get back to you, or choose View schedule.",
    ru: "Сейчас нет ссылки на запись. Напишите коротко — мы вернёмся, или выберите расписание.",
  });
}

export function registeredFlowContinuationClosing(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "ואם יש עוד משהו — כתבו כאן ואשמח לענות 🙂",
    en: "If there's anything else - write here and I'll be happy to help 🙂",
    ru: "Если есть ещё что-то — напишите сюда, с радостью отвечу 🙂",
  });
}

export function trialAlreadyRegisteredSoftIntro(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "כבר נרשמתם לניסיון — מעולה 🎉",
    en: "You're already signed up for a trial — wonderful 🎉",
    ru: "Вы уже записаны на пробное занятие — супер 🎉",
  });
}

export function trialAlreadyRegisteredSoftClosing(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "ואם יש שאלה נוספת — פשוט כתבו כאן.",
    en: "If you have another question — just write here.",
    ru: "Если есть ещё вопрос — просто напишите сюда.",
  });
}

export function trialLinkPostCtaMessage(
  lang: BusinessContentLanguage,
  mode: "automatic" | "manual" = "manual"
): string {
  if (mode === "automatic") {
    return pickContentCopy(lang, {
      he: "לאחר ההרשמה אשלח הוראות המשך 🎉\nלוקח לי עד 15 דקות לזהות הרשמה. אפשר בינתיים להמתין בהתרגשות!",
      en: "After registering, I'll send the next steps 🎉\nIt can take me up to 15 minutes to detect registration. Feel free to wait excitedly in the meantime!",
      ru: "После записи пришлю следующие шаги 🎉\nМне может понадобиться до 15 минут, чтобы увидеть регистрацию. Можно пока ждать с предвкушением!",
    });
  }
  return pickContentCopy(lang, {
    he: "לאחר ההרשמה, נא לכתוב לי *נרשמתי* ואשלח הוראות המשך 🎉",
    en: "After registering, please write me *I registered* and I'll send the next steps 🎉",
    ru: "После записи напишите мне *я записался* — и я пришлю следующие шаги 🎉",
  });
}

/** כשאישור הרשמה מגיע מה-CRM — «נרשמתי» לא מקבל את תבנית ההמשך המלאה. */
export function automaticRegistrationSelfReportedAck(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "איזה כיף! מחכים לראותך",
    en: "How exciting! Looking forward to seeing you",
    ru: "Как здорово! Ждём вас",
  });
}

export function secondaryOfferPurchasePostCtaMessage(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "לאחר התשלום כתבו *נרשמתי* ואשלח לכם את כל הפרטים!",
    en: "After payment, write *I registered* and we'll send you all the details!",
    ru: "После оплаты напишите *я записался* — и я пришлю все детали!",
  });
}

/** כשאין קישור/טווח למחירי מנויים — חוסר מידע + הפניה לשירות לקוחות */
export function membershipsPricingMissingReply(
  lang: BusinessContentLanguage,
  customerServicePhone = ""
): string {
  const phone = customerServicePhone.trim();
  if (lang === "en") {
    if (phone) {
      return `I don't have the membership pricing details right now. Please contact customer service:\n${phone}`;
    }
    return "I don't have the membership pricing details right now. Please contact our customer service.";
  }
  if (lang === "ru") {
    if (phone) {
      return `У меня сейчас нет информации о ценах на абонементы. Можно обратиться в службу поддержки:\n${phone}`;
    }
    return "У меня сейчас нет информации о ценах на абонементы. Можно обратиться в нашу службу поддержки.";
  }
  if (phone) {
    return `אין לי כרגע את המידע על מחירי המנויים. מוזמנים לפנות לשירות הלקוחות:\n${phone}`;
  }
  return "אין לי כרגע את המידע על מחירי המנויים. מוזמנים לפנות לשירות הלקוחות שלנו.";
}

export function addressOurPrefix(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "הכתובת שלנו:",
    en: "Our address:",
    ru: "Наш адрес:",
  });
}

export function addressDirectionsPrefix(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "ככה מגיעים אלינו:",
    en: "Here's how to reach us:",
    ru: "Как добраться:",
  });
}

export function addressMissingMessage(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "הכתובת תתעדכן בקרוב, ונשמח לשלוח לך את כל הפרטים.",
    en: "The address will be updated soon. Write us and we'll send you all the details.",
    ru: "Адрес скоро обновим. Напишите нам — пришлём все детали.",
  });
}

export function addressMissingCtaMessage(lang: BusinessContentLanguage): string {
  return pickContentCopy(lang, {
    he: "הכתובת תתעדכן בקרוב. כתבו לנו ונשלח לכם את כל הפרטים.",
    en: "The address will be updated soon. Write us and we'll send you all the details.",
    ru: "Адрес скоро обновим. Напишите нам — пришлём все детали.",
  });
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
  const prefix = pickContentCopy(lang, {
    he: "מוזמנים לבקר באינסטגרם שלנו בינתיים:",
    en: "Feel free to visit our Instagram in the meantime:",
    ru: "Можно пока заглянуть к нам в Instagram:",
  });
  return `${prefix}\n${url.trim()}`;
}

export function instagramFollowLine(lang: BusinessContentLanguage, url: string): string {
  const prefix = pickContentCopy(lang, {
    he: "מוזמנים לעקוב אחרינו באינסטגרם:",
    en: "Feel free to follow us on Instagram:",
    ru: "Можно подписаться на нас в Instagram:",
  });
  return `${prefix}\n${url.trim()}`;
}

export function schedulePickChangeServiceLabel(lang: BusinessContentLanguage = "he"): string {
  return pickContentCopy(lang, {
    he: "בחירת אימון אחר",
    en: "Choose another class",
    ru: "Выбрать другую тренировку",
  });
}

export function isSchedulePickChangeServiceLabel(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  return (
    t === schedulePickChangeServiceLabel("he") ||
    t === schedulePickChangeServiceLabel("en") ||
    t === schedulePickChangeServiceLabel("ru")
  );
}

export function pickScheduleSlotButtonsHint(lang: BusinessContentLanguage = "he"): string {
  return pickContentCopy(lang, {
    he: "בחרו מועד מהכפתורים למטה.",
    en: "Pick a time from the buttons below.",
    ru: "Выберите время кнопками ниже.",
  });
}
