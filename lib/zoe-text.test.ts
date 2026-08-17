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

assert.equal(
  sanitizeZoeOutboundLanguage("שהתרגול יתאים לבדיוק לשלב הזה שלך"),
  "שהתרגול יתאים בדיוק לשלב הזה שלך"
);

assert.equal(
  sanitizeZoeOutboundLanguage("שתוכלי להגידה לה על ההריון וליוודע איך היא עובדת"),
  "שתוכלי להגיד לה על ההריון ולוודא איך היא עובדת"
);

assert.equal(
  sanitizeZoeOutboundLanguage("היא יוכלה לתת לך התאמות, משהו שיותר מתוקף לך כרגע"),
  "היא יכולה לתת לך התאמות, משהו שיותר מתאים לך כרגע"
);

assert.equal(
  sanitizeZoeOutboundLanguage("במוקד - הרצפה האגן, הנשימה. בחוקי שלנו. וליוודע את ההשתנויות הזו, ולתאם קצר"),
  "במוקד - רצפת האגן, הנשימה. בחוג שלנו. ולוודא את השינויים האלה, ולתאם בקצרה"
);

console.log("zoe-text.test.ts: ok");
