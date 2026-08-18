/** אותיות ערביות שנוטות להתערבב בטקסט עברי (confusables) → עברית */
const ARABIC_TO_HEBREW_CHAR: Record<string, string> = {
  "\u0627": "א",
  "\u0628": "ב",
  "\u062a": "ת",
  "\u062b": "ת",
  "\u0629": "ה",
  "\u062c": "ג",
  "\u062d": "ח",
  "\u062e": "כ",
  "\u062f": "ד",
  "\u0630": "ד",
  "\u0631": "ר",
  "\u0632": "ז",
  "\u0633": "ס",
  "\u0634": "ש",
  "\u0635": "ס",
  "\u0636": "צ",
  "\u0637": "ט",
  "\u0639": "ע",
  "\u0641": "פ",
  "\u0642": "ק",
  "\u0643": "כ",
  "\u0644": "ל",
  "\u0645": "מ",
  "\u0646": "נ",
  "\u0647": "ה",
  "\u0648": "ו",
  "\u064a": "י",
  "\u06cc": "י",
};

/** מחליף אותיות ערביות בכתב עברי כשיש גם עברית בטקסט (טעות מודל). */
export function normalizeArabicScriptInHebrew(text: string): string {
  const t = String(text ?? "");
  if (!/[\u0590-\u05FF]/.test(t) || !/[\u0600-\u06FF]/.test(t)) return t;
  return [...t]
    .map((ch) => ARABIC_TO_HEBREW_CHAR[ch] ?? ch)
    .join("");
}

/** «גופים» / «לכל סוגי גופים» — לא תקני בעברית. */
function fixBodiesPhrasing(text: string): string {
  let s = String(text ?? "");
  s = s.replace(/\s*ו?לכל\s+סוגי\s+ה?גופים(?:\s+ו?ה?דרישות)?/giu, "");
  s = s.replace(/סוגי\s+ה?גופים/giu, "הרמות");
  s = s.replace(/גופים/giu, "רמות");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1");
  return s;
}

/** גבול מילה עברי — `\b` לא עובד על אותיות עבריות ב-JS. */
function hebWord(word: string): RegExp {
  return new RegExp(`(?<![\\u0590-\\u05FF])${word}(?![\\u0590-\\u05FF])`, "gu");
}

/** תיקוני עברית גלובליים — regex בלבד, ללא API (מיקרו-שניות). */
function applyGlobalHebrewLanguageFixes(text: string): string {
  return String(text ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\bלהטפל\b/gu, "לטפל")
    .replace(/\bאימן\b/gu, "אימון")
    .replace(/לא\s+יש\s+לי\s+את/giu, "אין לי את")
    .replace(/לא\s+יש\s+לי\b/giu, "אין לי")
    .replace(/לא\s+יש\s+מידע/giu, "אין לי מידע")
    .replace(/לתקשרי/gu, "ליצור קשר")
    .replace(/להתקשרי/gu, "להתקשר")
    .replace(/נירשמ/gu, "נרשמ")
    .replace(/נרישמ/gu, "נרשמ")
    .replace(/מצליחה\s+בחיפוש/giu, "בהצלחה בחיפוש")
    .replace(hebWord("לבדיוק"), "בדיוק")
    .replace(/להגידה\s+לה/gu, "להגיד לה")
    .replace(hebWord("להגידה"), "להגיד")
    .replace(/וליי?וודע/gu, "ולוודא")
    .replace(/ליי?וודע/gu, "לוודא")
    .replace(hebWord("יוכלה"), "יכולה")
    .replace(/יותר\s+מתוקף\s+לך/gu, "יותר מתאים לך")
    .replace(hebWord("מתוקף\\s+לך"), "מתאים לך")
    .replace(/בחוקי\s+שלנו/gu, "בחוג שלנו")
    .replace(/הרצפה\s+האגן/gu, "רצפת האגן")
    .replace(/ההשתנויות\s+הזו/gu, "השינויים האלה")
    .replace(/ולתאם\s+קצר/gu, "ולתאם בקצרה")
    .replace(/לתאם\s+קצר/gu, "לתאם בקצרה");
}

const LEAD_PLACEHOLDER_TOKEN_RE = /\{[A-Za-z][A-Za-z0-9_]*\}/g;
const LEAD_FRIENDLY_PLACEHOLDERS = ["(שם האימון)", "(שם המוצר)"];

/**
 * סוגריים של משתני תבנית ({serviceName}, (שם האימון)…) — אף פעם לא לליד.
 * שם שיעור אמיתי לא נמחק כאן; רק טוקנים טכניים שלא מולאו.
 */
export function stripUnresolvedLeadPlaceholders(text: string): string {
  let s = String(text ?? "");
  for (const token of LEAD_FRIENDLY_PLACEHOLDERS) {
    if (s.includes(token)) s = s.split(token).join("");
  }
  s = s.replace(LEAD_PLACEHOLDER_TOKEN_RE, "");
  s = s.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,!?])/g, "$1");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * שער שפה לכל הודעות זואי — דטרמיניסטי, ללא עיכוב (regex בלבד).
 * לא מזהה «משפטים לא הגיוניים» סמנטית; רק דפוסי שגיאה ידועים.
 */
export function sanitizeZoeOutboundLanguage(text: string): string {
  let s = normalizeArabicScriptInHebrew(String(text ?? ""));
  s = applyGlobalHebrewLanguageFixes(s);
  s = fixBodiesPhrasing(s);
  s = stripUnresolvedLeadPlaceholders(s);
  return s;
}

/** @deprecated השם נשמר לתאימות — השתמשו ב-sanitizeZoeOutboundLanguage */
export function sanitizeZoeDashes(text: string): string {
  return sanitizeZoeOutboundLanguage(text);
}

/** מחרוזות בתוך payload של Meta (טקסט, כפתורים, כותרות) */
export function sanitizeZoeOutboundDeep<T>(value: T): T {
  if (typeof value === "string") return sanitizeZoeOutboundLanguage(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeZoeOutboundDeep(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeZoeOutboundDeep(v);
    }
    return out as T;
  }
  return value;
}
