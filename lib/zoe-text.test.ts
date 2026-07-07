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

console.log("zoe-text.test.ts: ok");
