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

console.log("sales-flow-localize.test.ts: ok");
