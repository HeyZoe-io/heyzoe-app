import assert from "node:assert/strict";
import { defaultSalesFlowConfig } from "@/lib/sales-flow";
import { localizeSalesFlowConfigWithDictionaryOnly } from "@/lib/sales-flow-localize";
import { resolveLeadContentLanguage } from "@/lib/lead-ui-lang";
import { isSalesFlowStartTrigger } from "@/lib/sales-flow-start-triggers";
import { ctaHaveAQuestionLabel, isCtaHaveAQuestionMessage } from "@/lib/wa-cta-compact";
import { pickContentCopy } from "@/lib/business-content-lang";

const localized = localizeSalesFlowConfigWithDictionaryOnly(defaultSalesFlowConfig([]));
assert.equal(localized.greeting_opener.includes("Привет"), true);
assert.equal(localized.cta_buttons.some((b) => b.label === "Запись на пробное занятие"), true);

const localizedEn = localizeSalesFlowConfigWithDictionaryOnly(defaultSalesFlowConfig([]), new Set(), "en");
assert.equal(localizedEn.greeting_opener.includes("Hey"), true);
assert.equal(localizedEn.cta_buttons.some((b) => b.label === "Sign up for a trial class"), true);
assert.equal(
  localized.cta_buttons.find((b) => b.kind === "schedule")?.label,
  "Смотреть расписание"
);

assert.equal(
  resolveLeadContentLanguage({ inboundText: "Привет, хочу детали" }),
  "ru"
);
assert.equal(
  resolveLeadContentLanguage({ inboundText: "👍", persisted: "ru" }),
  "ru"
);
assert.equal(resolveLeadContentLanguage({ inboundText: "היי" }), "he");
assert.equal(
  resolveLeadContentLanguage({ inboundText: "אפשר ברוסית?", persisted: "he" }),
  "ru"
);

assert.equal(isSalesFlowStartTrigger("Давайте начнём"), true);
assert.equal(isCtaHaveAQuestionMessage("У меня вопрос"), true);
assert.equal(ctaHaveAQuestionLabel("ru"), "У меня вопрос");
assert.equal(
  pickContentCopy("ru", { he: "היי", en: "Hi", ru: "Привет" }),
  "Привет"
);

const hePick = defaultSalesFlowConfig([]).multi_service_question;
assert.equal(
  hePick.includes("אני אתן לך עליו עוד פרטים!"),
  true,
  "default product-pick question promises more details"
);
assert.equal(
  hePick.includes("תהיה אפשרות לבחור אימון אחר"),
  true,
  "default product-pick question mentions picking another class"
);
assert.equal(
  localizedEn.multi_service_question.includes("I'll give you more details about it!"),
  true
);
assert.equal(
  localizedEn.multi_service_question.includes("pick another class"),
  true
);
assert.equal(
  localized.multi_service_question.includes("Я расскажу о ней подробнее!"),
  true
);
assert.equal(
  localized.multi_service_question.includes("другую тренировку"),
  true
);

console.log("sales-flow-localize.test.ts: ok");
