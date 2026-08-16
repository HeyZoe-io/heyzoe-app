import assert from "node:assert/strict";
import {
  normalizeArabicScriptInHebrew,
  sanitizeZoeDashes,
  sanitizeZoeOutboundLanguage,
} from "@/lib/zoe-text";

assert.equal(
  normalizeArabicScriptInHebrew("כ\u0644 משתתף מקבל"),
  "כל משתתף מקבל"
);

assert.equal(
  sanitizeZoeDashes("טקסט — עם מקף"),
  "טקסט - עם מקף"
);

assert.equal(
  sanitizeZoeOutboundLanguage("לא יש לי את הפרטים על גופים"),
  "אין לי את הפרטים על רמות"
);

assert.equal(
  sanitizeZoeOutboundLanguage("אני ממליצה לתקשרי עם שירות הלקוחות שלנו בטלפון"),
  "אני ממליצה ליצור קשר עם שירות הלקוחות שלנו בטלפון"
);

assert.equal(
  sanitizeZoeOutboundLanguage("מוזמנים להתקשרי אלינו"),
  "מוזמנים להתקשר אלינו"
);

console.log("zoe-text.test.ts: ok");
