import assert from "node:assert/strict";
import {
  STUDIO_OVERVIEW_COMMUNITY_CLOSING_EN,
  STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE,
  isStudioOverviewIntentText,
  studioOverviewClosingForInbound,
} from "@/lib/wa-studio-overview-intent";

const yes = [
  "ספרו לי על הסטודיו",
  "תגידי לי על המקום",
  "מה יש אצלכם",
  "רוצה לשמוע עליכם",
  "פרטים על הסטודיו",
  "היי מה אתם מציעים",
  "tell me about the studio",
  "what do you offer",
  "רק רוצה פרטים",
  "מי אתם",
  "איזה שיעורים יש",
  "קצת על העסק",
  "אשמח לשמוע על הסטודיו",
  "מה האפשרויות",
  "ספרי קצת",
];

const no = [
  "אשמח לפרטים",
  "אשמח לשמוע",
  "הייי אשמח לשמוע",
  "אשמח לשמוע פרטים",
  "פרטים",
  "בואו נתחיל",
  "כמה עולה",
  "מה הכתובת",
  "מתי יש שיעורים",
  "איך נרשמים",
  "רוצה אימון ניסיון",
  "מה מדיניות הביטול",
  "איך מגיעים",
  "למי זה מתאים",
  "מה השעות",
  "יש עוד משהו שאני יכולה לעזור לך איתו",
];

for (const text of yes) {
  assert.equal(isStudioOverviewIntentText(text), true, `expected overview: "${text}"`);
}
for (const text of no) {
  assert.equal(isStudioOverviewIntentText(text), false, `expected not overview: "${text}"`);
}

assert.equal(studioOverviewClosingForInbound("ספרו לי על הסטודיו"), STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE);
assert.equal(studioOverviewClosingForInbound("tell me about the studio"), STUDIO_OVERVIEW_COMMUNITY_CLOSING_EN);

console.log("wa-studio-overview-intent.test.ts: ok");
