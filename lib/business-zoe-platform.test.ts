import assert from "node:assert/strict";
import { DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES } from "@/lib/business-zoe-platform-defaults";
import { mergeWithDefaultZoePlatform } from "@/lib/business-zoe-platform";
import { withMarketingWordPrecisionGuideline } from "@/lib/marketing-zoe-legal-defaults";

const WORD_PRECISION = "מילים שדומות באות אחת";

const defaultIdentity =
  DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories
    .find((c) => c.id === "personality")
    ?.sections?.find((s) => s.key === "identity")?.lines ?? [];
assert.ok(defaultIdentity.some((l) => l.includes("הבוטית של העסק") && l.includes("האקדמיה")));
assert.ok(defaultIdentity.some((l) => l.includes("מעבירה את הבקשה לצוות") && l.includes("אין לי את הפרטים")));

const defaultLegal =
  DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories
    .find((c) => c.id === "personality")
    ?.sections?.find((s) => s.key === "legal_rules")?.lines ?? [];
assert.ok(defaultLegal.some((l) => l.includes("כשהמשתמש כותב בעברית") && l.includes("באנגלית או ברוסית")));
assert.ok(defaultLegal.some((l) => l.includes("Hebrew, English, or Russian")));
assert.ok(defaultLegal.some((l) => l.includes(WORD_PRECISION)));
assert.ok(defaultLegal.some((l) => l.includes("מתוקה") && l.includes("מצוקה")));
assert.ok(defaultLegal.some((l) => l.includes("מנוי") && l.includes("מנוע")));
assert.ok(defaultLegal.some((l) => l.includes("עיסוי זה לא ספא") && l.includes("אל תמציאי סוג מקום")));
assert.ok(defaultLegal.some((l) => l.includes("כשתהיי רוצה") && l.includes("תרצי")));
assert.ok(defaultLegal.some((l) => l.includes("נכנסים, מבטלים את ההרשמה")));
assert.ok(defaultLegal.some((l) => l.includes("לא רק לחידוש")));
assert.ok(defaultLegal.some((l) => l.includes("אם ברצונך")));
assert.ok(defaultLegal.some((l) => l.includes("בינתיים תתאפרי") && l.includes("נשמח לראותך בשיעור")));
assert.ok(defaultLegal.some((l) => l.includes("נראה אותך בעוד X דקות") && l.includes("אין בעיה בכלל")));

const defaultVoiceExamples =
  DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories
    .find((c) => c.id === "personality")
    ?.sections?.find((s) => s.key === "voice_examples")?.lines ?? [];
assert.ok(defaultVoiceExamples.some((l) => l.includes("כשתהיי רוצה") && l.includes("אנחנו כאן כשתרצי")));
assert.ok(defaultVoiceExamples.some((l) => l.includes("בינתיים תתאפרי") && l.includes("נשמח לראותך בשיעור")));
assert.ok(
  defaultVoiceExamples.some((l) => l.includes("נראה אותך בעוד 10 דקות") && l.includes("קח את הזמן"))
);
assert.ok(
  defaultVoiceExamples.some((l) => l.includes("אם ברצונך לבטל את השיעור") && l.includes("נכנסים, מבטלים"))
);
assert.ok(defaultVoiceExamples.some((l) => l.includes("כל «רוצה» לליד") && l.includes("אם ברצונך להגיע מחר")));

const defaultVoiceStyle =
  DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories
    .find((c) => c.id === "personality")
    ?.sections?.find((s) => s.key === "voice_style")?.lines ?? [];
assert.ok(defaultVoiceStyle.some((l) => l.includes("לכל משפט של רצון")));

const storedWithoutPrecision = {
  categories: [
    {
      id: "personality",
      title: "זהות, חוקיות ואופי",
      description: "",
      lines: [],
      sections: [
        {
          key: "legal_rules",
          label: "חוקיות וכללים",
          lines: [
            "עברית בלבד — כתבי בכתב עברי בלבד.",
            "שמות שיעורים/אימונים — העתיקי בדיוק מרשימת «שירותים» בידע העסקי.",
            "עברית טבעית עם שמות עצם תקינים (למשל «בביטחון ובכיף» ולא «בטוח וכיפי»).",
            "בלי Markdown.",
          ],
        },
      ],
    },
  ],
};

const merged = mergeWithDefaultZoePlatform(storedWithoutPrecision);
const mergedLegal =
  merged.categories.find((c) => c.id === "personality")?.sections?.find((s) => s.key === "legal_rules")
    ?.lines ?? [];
assert.ok(mergedLegal.some((l) => l.includes(WORD_PRECISION)));
assert.ok(mergedLegal.some((l) => l.includes("כשהמשתמש כותב בעברית") && l.includes("באנגלית או ברוסית")));
assert.equal(mergedLegal.filter((l) => l.includes("עברית בלבד — כתבי בכתב עברי בלבד.")).length, 0);
assert.ok(mergedLegal.some((l) => l.includes("עיסוי זה לא ספא") && l.includes("אל תמציאי סוג מקום")));
assert.ok(mergedLegal.some((l) => l.includes("כשתהיי רוצה") && l.includes("תרצי")));
assert.equal(
  mergedLegal.filter((l) => l.includes("עיסוי זה לא ספא") && l.includes("אל תמציאי סוג מקום")).length,
  1
);
assert.equal(mergedLegal.filter((l) => l.includes("אהלן יגאל")).length, 0);

const storedOldIdentity = {
  categories: [
    {
      id: "personality",
      title: "זהות, חוקיות ואופי",
      description: "",
      lines: [],
      sections: [
        {
          key: "identity",
          label: "מי זואי",
          lines: [
            "זואי היא נציגת השירות של העסק מול הלקוחות והלידים.",
            "השם שמוצג ללקוחות הוא שם הנציגה של העסק.",
          ],
        },
      ],
    },
  ],
};
const mergedIdentity =
  mergeWithDefaultZoePlatform(storedOldIdentity)
    .categories.find((c) => c.id === "personality")
    ?.sections?.find((s) => s.key === "identity")?.lines ?? [];
assert.ok(mergedIdentity.some((l) => l.includes("הבוטית של העסק") && l.includes("לא נציגת קבלה")));
assert.ok(mergedIdentity.some((l) => l.includes("אהלן יגאל")));
assert.ok(mergedIdentity.some((l) => l.includes("רק בנושאים מנהלתיים")));
assert.equal(mergedIdentity.filter((l) => l.includes("נציגת השירות של העסק מול הלקוחות")).length, 0);

const storedOldUnknownKnowledge = {
  categories: [
    {
      id: "situations",
      title: "מצבים מיוחדים",
      description: "",
      lines: [],
      sections: [
        {
          key: "unknown_knowledge",
          label: "אין תשובה בידע / הפניה לשירות",
          lines: [
            "רק אם באמת אין מידע: פתחי בנוסח תקני כמו «אין לי את הפרטים» / «אין לי כרגע מידע על כך».",
          ],
        },
      ],
    },
  ],
};
const mergedUnknown =
  mergeWithDefaultZoePlatform(storedOldUnknownKnowledge)
    .categories.find((c) => c.id === "situations")
    ?.sections?.find((s) => s.key === "unknown_knowledge")?.lines ?? [];
assert.ok(mergedUnknown.some((l) => l.includes("מעבירה את הבקשה לצוות") && l.includes("התראת נציג")));
assert.equal(
  mergedUnknown.filter((l) => l.includes("פתחי בנוסח תקני כמו") && !l.includes("מעבירה את הבקשה לצוות"))
    .length,
  0
);

const marketingOld = [
  "עברית בלבד בפנייה לליד.",
  "עברית טבעית עם שמות עצם תקינים: «בביטחון ובכיף».",
];
const marketingInjected = withMarketingWordPrecisionGuideline(marketingOld);
assert.ok(marketingInjected.some((l) => l.includes(WORD_PRECISION)));
assert.equal(withMarketingWordPrecisionGuideline(marketingInjected).length, marketingInjected.length);

const marketingOldGender = [
  "ניסוח נייטרלי לגבי הליד: בלי אתה/את. דוגמאות: «אבל אם ברצונך לחדש».",
];
const marketingGenderUpgraded = withMarketingWordPrecisionGuideline(marketingOldGender);
assert.ok(marketingGenderUpgraded.some((l) => l.includes("לא רק לחידוש") && l.includes("אם ברצונך להגיע")));

const storedOldTone = {
  categories: [
    {
      id: "personality",
      title: "זהות, חוקיות ואופי",
      description: "",
      lines: [],
      sections: [
        {
          key: "tone_analysis",
          label: "טון לפי סוג עסק",
          lines: [
            "טיפול / wellness / עיסוי / קוסמטיקה / ספא / יוגה רגועה / מדיטציה — קול רגוע, אלגנטי, מכיל ומרגיע.",
          ],
        },
      ],
    },
  ],
};
const mergedTone =
  mergeWithDefaultZoePlatform(storedOldTone)
    .categories.find((c) => c.id === "personality")
    ?.sections?.find((s) => s.key === "tone_analysis")?.lines ?? [];
assert.ok(mergedTone.some((l) => l.includes("עיסוי זה לא ספא") && l.includes("קול רגוע")));
assert.equal(mergedTone.filter((l) => l.includes("אל תמציאי סוג מקום")).length, 0);

const storedOldExamples = {
  categories: [
    {
      id: "personality",
      title: "זהות, חוקיות ואופי",
      description: "",
      lines: [],
      sections: [
        {
          key: "voice_examples",
          label: "דוגמאות טון (few-shot)",
          lines: ["ליד: «כמה אנשים יש בשיעור?» → זואי: «השיעורים אצלנו קטנים.»"],
        },
        {
          key: "voice_style",
          label: "סגנון שפה (קול זואי)",
          lines: ["כתבי בעברית מדוברת וטבעית, כמו ישראלית אמיתית שכותבת בוואטסאפ."],
        },
      ],
    },
  ],
};
const mergedPersonality =
  mergeWithDefaultZoePlatform(storedOldExamples).categories.find((c) => c.id === "personality")
    ?.sections ?? [];
const mergedExamples = mergedPersonality.find((s) => s.key === "voice_examples")?.lines ?? [];
const mergedStyle = mergedPersonality.find((s) => s.key === "voice_style")?.lines ?? [];
assert.ok(mergedExamples.some((l) => l.includes("כשתהיי רוצה") && l.includes("אנחנו כאן כשתרצי")));
assert.ok(mergedExamples.some((l) => l.includes("אם ברצונך לבטל את השיעור") && l.includes("נכנסים, מבטלים")));
assert.ok(mergedExamples.some((l) => l.includes("כל «רוצה» לליד") && l.includes("אם ברצונך להגיע מחר")));
assert.ok(mergedStyle.some((l) => l.includes("תהיי רוצה") && l.includes("תרצי")));
assert.ok(mergedStyle.some((l) => l.includes("לכל משפט של רצון")));

const storedOldGender = {
  categories: [
    {
      id: "personality",
      title: "זהות, חוקיות ואופי",
      description: "",
      lines: [],
      sections: [
        {
          key: "legal_rules",
          label: "חוקיות וכללים",
          lines: [
            "כתיבה ניטרלית מגדרית: לרוב לא יודעים אם הליד גבר או אישה — ביכולתך.",
            "טבעיות וחום בניסוח ניטרלי: גוונ בין הדרכים. מחר ניתן לקבל חבילה.",
          ],
        },
      ],
    },
  ],
};
const mergedOldGender =
  mergeWithDefaultZoePlatform(storedOldGender)
    .categories.find((c) => c.id === "personality")
    ?.sections?.find((s) => s.key === "legal_rules")?.lines ?? [];
assert.ok(mergedOldGender.some((l) => l.includes("לא רק לחידוש")));
assert.ok(mergedOldGender.some((l) => l.includes("נכנסים, מבטלים את ההרשמה")));

console.log("business-zoe-platform.test.ts: ok");
