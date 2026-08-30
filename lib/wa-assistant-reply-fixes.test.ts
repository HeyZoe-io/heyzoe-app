import assert from "node:assert/strict";
import {
  applyKnownAssistantReplyFixes,
  buildWaSpellingAndPhrasingPromptRule,
} from "@/lib/wa-assistant-reply-fixes";
import type { BusinessKnowledgePack } from "@/lib/business-context";

const knowledge = {
  serviceNamesForOpening: ["שיעור יוגה למתחילים", "שיעור יוגה ממשיכים", "שיעור יוגה למתקדמים"],
  salesFlowServices: [{ name: "יוגה לכל הרמות" }],
} as Pick<BusinessKnowledgePack, "serviceNamesForOpening" | "salesFlowServices"> as BusinessKnowledgePack;

const input =
  "יש לנו שיעורים למתחילים, ממשיקים, מתקדמים, יוגה לכל הרמות ויוגה לנשים.";

const fixed = applyKnownAssistantReplyFixes(input, { knowledge });

assert.match(fixed, /ממשיכים/);
assert.doesNotMatch(fixed, /ממשיקים/);

const leaked =
  "הבנתי! 😊 אתה צודק - אני לא מנהלת הגדרות או כיבויים של בוט. אלה פעולות שמנוהלות דרך **דף השיחות** בפלטפורמה, לא כאן בצ'אט. אם אתה צריך:\n- **לכבות בוט על מספר ספציפי** → דף השיחות → בחר את השיחה → הגדרות";
const scrubbed = applyKnownAssistantReplyFixes(leaked, { knowledge });
assert.doesNotMatch(scrubbed, /דף השיחות|כיבוי|HeyZoe|דשבורד/i);
assert.match(scrubbed, /השירותים שלנו/);

const scheduleKeep = [
  "אפשר לראות את מערכת השעות כאן: https://arbox.example.com/schedule",
  "הלוח המלא בלינק למערכת שעות, ואפשר גם להירשם משם לשיעור ניסיון.",
  "מחירי המנויים מופיעים בדשבורד של האפליקציה אצלכם באפליקציית הסטודיו.",
  "זה סטודיו בוטיק, השיעורים קטנים.",
  "אני זואי, נציגת הסטודיו. במה אפשר לעזור?",
  "הגדרות השיעור למתחילים: להביא מזרן ומים.",
].map((t) => applyKnownAssistantReplyFixes(t, { knowledge }));
assert.match(scheduleKeep[0], /מערכת השעות/);
assert.match(scheduleKeep[0], /arbox\.example\.com/);
assert.match(scheduleKeep[1], /מערכת שעות/);
assert.match(scheduleKeep[2], /דשבורד של האפליקציה/);
assert.match(scheduleKeep[3], /בוטיק/);
assert.match(scheduleKeep[4], /אני זואי/);
assert.match(scheduleKeep[5], /הגדרות השיעור/);

const mixed =
  "אפשר לראות את מערכת השעות כאן: https://arbox.example.com/schedule\nלכבות בוט זה דרך דף השיחות.";
const mixedFixed = applyKnownAssistantReplyFixes(mixed, { knowledge });
assert.match(mixedFixed, /מערכת השעות/);
assert.match(mixedFixed, /arbox\.example\.com/);
assert.doesNotMatch(mixedFixed, /דף השיחות|לכבות בוט/);

const normal = applyKnownAssistantReplyFixes("השיעורים אצלנו קטנים ואינטימיים, ויש יחס אישי.", { knowledge });
assert.match(normal, /השיעורים אצלנו/);

const pregnancyTypos =
  "חשוב שהתרגול יתאים לבדיוק לשלב הזה שלך. זה קצת כיוון אחר מאיינגר וויניאסה שאתם מכירות. במוקד - הרצפה האגן. שתוכלי להגידה לה על ההריון וליוודע איך היא עובדת עם הרמה שלך וההשתנויות הזו. היא יוכלה לתת לך התאמות או משהו שיותר מתוקף לך כרגע. תוכלי להתקשר ולתאם קצר, או לשאול על יוגה בהריון בחוקי שלנו.";
const pregnancyFixed = applyKnownAssistantReplyFixes(pregnancyTypos, { knowledge });
assert.match(pregnancyFixed, /יתאים בדיוק לשלב/);
assert.doesNotMatch(pregnancyFixed, /לבדיוק/);
assert.match(pregnancyFixed, /שאתם מכירים/);
assert.doesNotMatch(pregnancyFixed, /מכירות/);
assert.match(pregnancyFixed, /רצפת האגן/);
assert.match(pregnancyFixed, /להגיד לה/);
assert.match(pregnancyFixed, /ולוודא איך/);
assert.match(pregnancyFixed, /השינויים האלה/);
assert.match(pregnancyFixed, /היא יכולה לתת/);
assert.match(pregnancyFixed, /יותר מתאים לך/);
assert.match(pregnancyFixed, /ולתאם בקצרה/);
assert.match(pregnancyFixed, /בחוג שלנו/);

const illness = applyKnownAssistantReplyFixes(
  "אני מבינה שזה מתסכל, בטח קשה לעמוד בצד. אבל החלמה טובה היא ההשקעה הטובה ביותר שלך כרגע",
  { knowledge }
);
assert.equal(illness, "מצטערת לשמוע, מאחלת החלמה מהירה!");

const freeze = applyKnownAssistantReplyFixes(
  "לגבי החיובים - הטוב שיש לנו מדיניות גמישה. ניתן להקפיא את המנוי שלך עד 14 ימים על כל חצי שנה.",
  { knowledge }
);
assert.equal(freeze, "ניתן להקפיא את המנוי שלך עד 14 ימים על כל חצי שנה.");

const mixedIllness = applyKnownAssistantReplyFixes(
  "אני מבינה שזה מתסכל, בטח קשה לעמוד בצד. ניתן להקפיא את המנוי עד 14 ימים.",
  { knowledge }
);
assert.match(mixedIllness, /מצטערת לשמוע, מאחלת החלמה מהירה!/);
assert.match(mixedIllness, /ניתן להקפיא את המנוי עד 14 ימים/);
assert.doesNotMatch(mixedIllness, /מתסכל|לעמוד בצד/);

const keepInvestment = applyKnownAssistantReplyFixes("זו ההשקעה הטובה ביותר בסטודיו.", { knowledge });
assert.equal(keepInvestment, "זו ההשקעה הטובה ביותר בסטודיו.");

const weekendIntent = applyKnownAssistantReplyFixes(
  "מושלם! אנחנו פה גם בסופ״ש. אל תתנגדי לעצמך - בואי תרשמי לשיעור שמתאים לך 🙂",
  { knowledge }
);
assert.match(weekendIntent, /מושלם/);
assert.match(weekendIntent, /סופ/);
assert.doesNotMatch(weekendIntent, /תתנגדי|תרשמי/);

const lateCheer = applyKnownAssistantReplyFixes(
  "אין בעיה בכלל! 🙂 אנחנו כאן, קח את הזמן שצריך. נראה אותך בעוד 10 דקות, בטוח שזה יעבוד. עד עכשיו!",
  { knowledge }
);
assert.match(lateCheer, /אנחנו כאן/);
assert.doesNotMatch(lateCheer, /בטוח שזה יעבוד|קח את הזמן|עד עכשיו/);

const takeYourTime = applyKnownAssistantReplyFixes(
  "אווו זה ממש מרגיע לשמוע. בינתיים קח את הזמן שלך, מגנזיום והרבה מים. נתראה בחמישי",
  { knowledge }
);
assert.doesNotMatch(takeYourTime, /קח את הזמן/);
assert.match(takeYourTime, /מרגיע לשמוע/);

const prematureReg = applyKnownAssistantReplyFixes(
  "מושלם! יום שני 18:00 זה שיעור מעולה 🙂 עכשיו בואו נרשום אתכם. הרישום והתשלום נעשים דרך לינק מאובטח כאן: https://plando.co.il/self_services/embed_store/20951 כל הכבוד! נרשמתם בהצלחה 🎉 זה קורה בכתובת: הרצל 1",
  { knowledge }
);
assert.match(prematureReg, /plando\.co\.il/);
assert.doesNotMatch(prematureReg, /נרשמתם בהצלחה|זה קורה בכתובת/);

const timesListed = applyKnownAssistantReplyFixes(
  "בשיעורים אצלנו למדים את הבסיס. יום ראשון 08:30\nיום שני 18:00",
  { knowledge }
);
assert.match(timesListed, /לומדים/);
assert.match(timesListed, /מתי נוח לך להגיע\?/);

const fakeSchedule = applyKnownAssistantReplyFixes(
  "מערכת השעות: [תמונה של לוח השיעורים תישלח כאן] לגבי תיאום הגעה - כשתלחצי על הרשמה.",
  { knowledge }
);
assert.doesNotMatch(fakeSchedule, /תישלח כאן|\[תמונה/);
assert.match(fakeSchedule, /תיאום הגעה/);

const inventedSlot = applyKnownAssistantReplyFixes(
  "💜 בכל עת שתצטרכי - אני כאן. נשמח לראותך בחומש בשמונה!",
  { knowledge }
);
assert.match(inventedSlot, /בכל עת שתצטרכי/);
assert.doesNotMatch(inventedSlot, /חומש|שמונה|נשמח לראותך/);

const inventedThursday = applyKnownAssistantReplyFixes(
  "נשמח לראותך ביום חמישי בשעה 18:00",
  { knowledge }
);
assert.equal(inventedThursday, "בכל עת שתצטרכי - אני כאן 💜");

const keepSeeYouNoTime = applyKnownAssistantReplyFixes("מושלם! אנחנו פה גם בסופ״ש. נשמח לראותך.", {
  knowledge,
});
assert.match(keepSeeYouNoTime, /נשמח לראותך/);

const keepSeeYouInClass = applyKnownAssistantReplyFixes("נשמח לראותך בשיעור", { knowledge });
assert.equal(keepSeeYouInClass, "נשמח לראותך בשיעור");

const keepAfterRegSlot = applyKnownAssistantReplyFixes(
  "מתרגשות לראותך בקרוב ברפורמר ביום רביעי בשעה 18:00",
  { knowledge, trialRegistered: true }
);
assert.match(keepAfterRegSlot, /יום רביעי בשעה 18:00/);

const spellingRule = buildWaSpellingAndPhrasingPromptRule(knowledge, {
  suppressFollowUpQuestion: true,
});
assert.match(spellingRule, /מילים שדומות באות אחת/);
assert.match(spellingRule, /מתוקה/);
assert.match(spellingRule, /מנוי/);
assert.match(spellingRule, /עיסוי זה לא ספא/);

console.log("wa-assistant-reply-fixes.test.ts: ok");
