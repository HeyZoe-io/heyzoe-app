import assert from "node:assert/strict";
import {
  stripInlineNumberedChoiceListTail,
  stripNumberedChoiceLinesAnywhere,
} from "@/lib/whatsapp";

const limitless =
  "איזה כיף! 🙂 Power & HIIT הם אימון שמשלב כוח. בשבת יש לנו שיעור ב־18:30 במתחם שלנו בבן עטר 31 תל אביב. עכשיו רק נותר לשריין את מקומך באמצעות תשלום מאובטח - 80 ₪ בלבד לשני אימוני היכרות, הטבה דרך השיחה שלנו כאן 🙂 לשמור לך מקום? 1. הרשמה לשיעור ניסיון\n2. צפייה במערכת השעות";

const stripped = stripInlineNumberedChoiceListTail(limitless);
assert.equal(stripped.includes("1. הרשמה"), false);
assert.equal(stripped.includes("2. צפייה"), false);
assert.match(stripped, /לשמור לך מקום\?$/u);

assert.equal(
  stripNumberedChoiceLinesAnywhere("מענה\n1. הרשמה לשיעור ניסיון\n2. צפייה במערכת השעות").includes("1. הרשמה"),
  false
);

const withFlag = stripNumberedChoiceLinesAnywhere(limitless, undefined, { includeMidline: true });
assert.equal(withFlag.includes("1. הרשמה"), false);
assert.equal(withFlag.includes("2. צפייה"), false);

const ctaBody = "עכשיו רק נותר לשריין את מקומך.\nלשמור לך מקום? 💜";
assert.equal(stripNumberedChoiceLinesAnywhere(ctaBody), ctaBody);
assert.equal(stripInlineNumberedChoiceListTail(ctaBody), ctaBody);

const compactLabels = ["הרשמה לשיעור ניסיון", "יש לי שאלה"];
const yogaAnswer = "תלבשו בגדי יוגה! לגברים - בגדים לא צמודים לגוף.";
assert.equal(stripNumberedChoiceLinesAnywhere(yogaAnswer, compactLabels), yogaAnswer);
assert.equal(
  stripNumberedChoiceLinesAnywhere(`${yogaAnswer}\n1. הרשמה לשיעור ניסיון\n2. יש לי שאלה`, compactLabels).includes(
    "1. הרשמה"
  ),
  false
);
assert.match(
  stripNumberedChoiceLinesAnywhere(`${yogaAnswer}\n1. הרשמה לשיעור ניסיון\n2. יש לי שאלה`, compactLabels),
  /תלבשו בגדי יוגה/
);

assert.equal(stripNumberedChoiceLinesAnywhere("מה הצעד הבא?", compactLabels), "מה הצעד הבא?");
assert.equal(stripNumberedChoiceLinesAnywhere("מה הצעד הבא?", ["הרשמה לשיעור ניסיון"]), "מה הצעד הבא?");
assert.equal(
  stripNumberedChoiceLinesAnywhere("תלבשו בגדי יוגה!\nמה הצעד הבא?", compactLabels).includes("מה הצעד הבא"),
  false
);

console.log("whatsapp-numbered-strip.test.ts: ok");
