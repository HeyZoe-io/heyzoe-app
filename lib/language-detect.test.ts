import assert from "node:assert/strict";
import { detectMessageLanguage, pickByDetectedLanguage } from "@/lib/language-detect";

assert.equal(detectMessageLanguage("היי, אפשר להירשם לשיעור ניסיון?"), "he");
assert.equal(detectMessageLanguage("Hi, can I book a trial class?"), "en");
assert.equal(detectMessageLanguage("Привет, можно записаться на пробное занятие?"), "ru");
assert.equal(detectMessageLanguage("Здравствуйте! Есть места на завтра?"), "ru");
assert.equal(detectMessageLanguage("123 🙂"), "unknown");
assert.equal(detectMessageLanguage(""), "unknown");
assert.equal(detectMessageLanguage("Yoga 18:00"), "en");
assert.equal(detectMessageLanguage("יוגה 18:00"), "he");
assert.equal(detectMessageLanguage("Хочу на йогу в 18:00"), "ru");
assert.equal(
  detectMessageLanguage("Привет, есть у вас пилатес Reformer?"),
  "ru"
);

assert.equal(pickByDetectedLanguage("ru", { he: "he", en: "en", ru: "ru" }), "ru");
assert.equal(pickByDetectedLanguage("en", { he: "he", en: "en", ru: "ru" }), "en");
assert.equal(pickByDetectedLanguage("unknown", { he: "he", en: "en", ru: "ru" }), "he");

console.log("language-detect.test.ts: ok");
