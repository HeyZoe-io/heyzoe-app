import assert from "node:assert/strict";
import { buildSystemPrompt } from "@/lib/business-context";
import { applyKnownAssistantReplyFixes } from "@/lib/wa-assistant-reply-fixes";
import { formatLongReplySpacing, formatServiceDescriptionList } from "@/lib/wa-reply-spacing";

const wall = `Hey Adrienne! Welcome 😊 So happy to hear you want to try us out! Our classes are in *Hebrew, but don't worry - you'll definitely be able to follow along. Our instructors give plenty of hands-on guidance and adjustments, so even if the language feels like a lot at first, you'll pick up the movements quickly. Plus, Pilates is pretty universal! Since you've got reformer experience, that's awesome. We run **Pilates Mekkanim* (Reformer Pilates) classes throughout the week. Here's what we have coming up:
*Today (Sunday):* 7 PM, 8 PM
*Tomorrow (Monday):* 7:30 AM, 8:30 AM, 9:30 AM, 6 PM, 8 PM
*Wednesday:* 7:30 AM, 8:30 AM, 7 PM, 8 PM
*Friday:* 7:30 AM, 8:30 AM, 9:30 AM
When works best for you? 💜`;

const spaced = formatLongReplySpacing(wall);

assert.match(spaced, /try us out!\n\nOur classes are in/);
assert.match(spaced, /that's awesome\.\n\nWe run/);
assert.match(spaced, /coming up:\n\n\*Today \(Sunday\):\*/);
assert.match(spaced, /\*Today \(Sunday\):\*\n7 PM\n8 PM\n\n\*Tomorrow \(Monday\):\*/);
assert.match(spaced, /\*Tomorrow \(Monday\):\*\n7:30 AM\n8:30 AM\n9:30 AM\n6 PM\n8 PM/);
assert.match(spaced, /\*Wednesday:\*\n7:30 AM\n8:30 AM\n7 PM\n8 PM\n\n\*Friday:\*/);
assert.match(spaced, /9:30 AM\n\nWhen works best for you\?/);
assert.doesNotMatch(spaced, /7 PM, 8 PM/);
assert.doesNotMatch(spaced, /8:30 AM, 9:30 AM/);

const hebrew = formatLongReplySpacing(
  "שמחה שבאת. האימונים בימים האלה: ראשון 18:00, שני 19:30, שלישי 20:00. הכתובת הרצל 5. המדיניות ביטול עד 12 שעות מראש."
);
assert.match(hebrew, /שמחה שבאת\.\n\nהאימונים בימים האלה:/);
assert.match(hebrew, /ראשון 18:00\nשני 19:30\nשלישי 20:00/);
assert.match(hebrew, /20:00\n\nהכתובת הרצל 5\./);
assert.match(hebrew, /הרצל 5\.\n\nהמדיניות ביטול/);
assert.doesNotMatch(hebrew, /18:00,/);

const branches = formatLongReplySpacing(
  "סניף עמיעד: האימונים בימים ראשון 18:00, שני 19:00. הכתובת דרך העמק 4. סניף קריית שמונה: האימונים בימים שלישי 17:00, חמישי 18:30. הכתובת התמרים 2. המדיניות זהה בשני הסניפים."
);
assert.match(branches, /עמיעד:/);
assert.match(branches, /ראשון 18:00\nשני 19:00/);
assert.match(branches, /\n\nהכתובת דרך העמק 4\./);
assert.match(branches, /\n\nסניף קריית שמונה:/);
assert.match(branches, /שלישי 17:00\nחמישי 18:30/);
assert.match(branches, /\n\nהכתובת התמרים 2\./);
assert.match(branches, /\n\nהמדיניות זהה/);

assert.equal(formatLongReplySpacing("מושלם! נשמח לראותך."), "מושלם! נשמח לראותך.");
assert.equal(
  formatLongReplySpacing("מה נוח לך?\n1. הכתובת\n2. המחיר"),
  "מה נוח לך?\n1. הכתובת\n2. המחיר"
);

const again = formatLongReplySpacing(spaced);
assert.equal(again, spaced);

const viaFixes = applyKnownAssistantReplyFixes(wall, { knowledge: null, language: "en" });
assert.match(viaFixes, /\*Today \(Sunday\):\*\n7 PM\n8 PM/);
assert.match(viaFixes, /try us out!\n\nOur classes/);

const omerNames = ["Max power", "Legs on fire", "Abs+ Booty", "functional flow", "Friday power", "upper power"];
const omerWall =
  "בטח! הנה תיאור קצר של כל אימון: Max power - שיעור דינמי בעבודת תחנות. תרגילים אינטנסיביים ונותנים תוצאות מהירות. Legs on fire - אימון אינטנסיבי לחיזוק הרגליים, עם סשן TABATA בסוף. Abs+ Booty - מתמקד בחיזוק הבטן והישבן. Functional flow - משלב תנועות פונקציונליות. Friday power - אימון לשיפור כוח וסיבולת. Upper power - ממוקד בחיזוק החלק העליון של הגוף, עם דגש על טכניקה נכונה. איזה מהם מושך אותך? 🙂";
const omerSpaced = formatServiceDescriptionList(omerWall, omerNames);
assert.equal(
  omerSpaced,
  [
    "בטח! הנה תיאור קצר של כל אימון:",
    "Max power - שיעור דינמי בעבודת תחנות. תרגילים אינטנסיביים ונותנים תוצאות מהירות.",
    "Legs on fire - אימון אינטנסיבי לחיזוק הרגליים, עם סשן TABATA בסוף.",
    "Abs+ Booty - מתמקד בחיזוק הבטן והישבן.",
    "Functional flow - משלב תנועות פונקציונליות.",
    "Friday power - אימון לשיפור כוח וסיבולת.",
    "Upper power - ממוקד בחיזוק החלק העליון של הגוף, עם דגש על טכניקה נכונה.",
    "איזה מהם מושך אותך? 🙂",
  ].join("\n\n")
);
assert.equal(formatServiceDescriptionList(omerSpaced, omerNames), omerSpaced);
const omerOne = "Max power - שיעור דינמי בעבודת תחנות. רוצה לנסות?";
assert.equal(formatServiceDescriptionList(omerOne, omerNames), omerOne);
const omerMention = "אפשר להגיע ל-Max power או ל-Legs on fire השבוע.";
assert.equal(formatServiceDescriptionList(omerMention, omerNames), omerMention);
const omerLines = "יש לנו:\nMax power - כוח.\nLegs on fire - רגליים.";
assert.equal(formatServiceDescriptionList(omerLines, omerNames), "יש לנו:\n\nMax power - כוח.\n\nLegs on fire - רגליים.");

const prompt = buildSystemPrompt(null, "studio", "whatsapp");
assert.match(prompt, /עיצוב תשובה ארוכה \(כל הסניפים\)/);
assert.match(prompt, /כל אימון בשורה משלו/);
const webPrompt = buildSystemPrompt(null, "studio", "web");
assert.doesNotMatch(webPrompt, /עיצוב תשובה ארוכה \(כל הסניפים\)/);

console.log("wa-reply-spacing.test.ts: ok");
