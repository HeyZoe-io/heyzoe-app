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

assert.equal(
  sanitizeZoeOutboundLanguage("יש לנו אימונים Strength טהורים עם תוכנית."),
  "יש לנו אימונים Strength טהורים עם תוכנית."
);

assert.equal(
  sanitizeZoeOutboundLanguage("יש לנו אימונים {serviceName} טהורים עם תוכנית."),
  "יש לנו אימונים טהורים עם תוכנית."
);

assert.equal(
  sanitizeZoeOutboundLanguage("מושלם (שם האימון) אצלנו. (שם המוצר)"),
  "מושלם אצלנו."
);

assert.equal(
  sanitizeZoeOutboundLanguage("נשמח (אופציונלי) אם תאשרי."),
  "נשמח (אופציונלי) אם תאשרי."
);

assert.equal(
  sanitizeZoeOutboundLanguage("בשיעורים אצלנו למדים את עקרונות הבסיס"),
  "בשיעורים אצלנו לומדים את עקרונות הבסיס"
);
assert.equal(
  sanitizeZoeOutboundLanguage("המורים מלמדים בסבלנות"),
  "המורים מלמדים בסבלנות"
);
assert.equal(
  sanitizeZoeOutboundLanguage("בהחלמה מהירה!"),
  "החלמה מהירה!"
);
assert.equal(
  sanitizeZoeOutboundLanguage("מצטערת לשמוע, מאחלת בהחלמה מהירה!"),
  "מצטערת לשמוע, מאחלת החלמה מהירה!"
);
assert.equal(
  sanitizeZoeOutboundLanguage("אנחנו כאן כשתהיי רוצה 🙂"),
  "אנחנו כאן כשתרצי 🙂"
);
assert.equal(
  sanitizeZoeOutboundLanguage("אם תהיי רוצה, כתבי לי"),
  "אם תרצי, כתבי לי"
);
assert.equal(
  sanitizeZoeOutboundLanguage("תהיי רוצה לחזור - אנחנו כאן"),
  "תרצי לחזור - אנחנו כאן"
);

console.log("zoe-text.test.ts: ok");
