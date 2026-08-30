import assert from "node:assert/strict";
import { DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES } from "@/lib/business-zoe-platform-defaults";
import { mergeWithDefaultZoePlatform } from "@/lib/business-zoe-platform";
import { withMarketingWordPrecisionGuideline } from "@/lib/marketing-zoe-legal-defaults";

const WORD_PRECISION = "מילים שדומות באות אחת";

const defaultLegal =
  DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories
    .find((c) => c.id === "personality")
    ?.sections?.find((s) => s.key === "legal_rules")?.lines ?? [];
assert.ok(defaultLegal.some((l) => l.includes(WORD_PRECISION)));
assert.ok(defaultLegal.some((l) => l.includes("מתוקה") && l.includes("מצוקה")));
assert.ok(defaultLegal.some((l) => l.includes("מנוי") && l.includes("מנוע")));
assert.ok(defaultLegal.some((l) => l.includes("עיסוי זה לא ספא") && l.includes("אל תמציאי סוג מקום")));

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
assert.ok(mergedLegal.some((l) => l.includes("עיסוי זה לא ספא") && l.includes("אל תמציאי סוג מקום")));
assert.equal(
  mergedLegal.filter((l) => l.includes("עיסוי זה לא ספא") && l.includes("אל תמציאי סוג מקום")).length,
  1
);

const marketingOld = [
  "עברית בלבד בפנייה לליד.",
  "עברית טבעית עם שמות עצם תקינים: «בביטחון ובכיף».",
];
const marketingInjected = withMarketingWordPrecisionGuideline(marketingOld);
assert.ok(marketingInjected.some((l) => l.includes(WORD_PRECISION)));
assert.equal(withMarketingWordPrecisionGuideline(marketingInjected).length, marketingInjected.length);

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

console.log("business-zoe-platform.test.ts: ok");
