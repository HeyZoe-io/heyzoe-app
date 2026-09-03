import assert from "node:assert/strict";
import {
  buildStudioScopeRedirectReply,
  looksLikeBotConfigMetaReply,
  matchesBotConfigMetaTalk,
  WA_STUDIO_SCOPE_REDIRECT_HE,
  WA_STUDIO_SCOPE_REDIRECT_EN,
} from "@/lib/wa-bot-config-meta";

const yigalOwnerMsg = `היי מותק בוקר אור!
מה דעתך שנשנה את החוקיות לחוקיות הרגילה שלא נפתח פלואו מכירה לכל הודעה וזואי יכולה לשלוח להם פלואו מכירה רק כשהיא מזהה שזה רלוונטי, או אם כותבים לה "אשמח לפרטים" או משהו בסגנון`;

assert.equal(matchesBotConfigMetaTalk(yigalOwnerMsg), true);
assert.equal(matchesBotConfigMetaTalk("תשני את החוקיות לפתיחה רק בטריגר"), true);
assert.equal(matchesBotConfigMetaTalk("איך מכבים את הבוט על המספר הזה"), true);
assert.equal(matchesBotConfigMetaTalk("please change the sales flow so it doesn't open on every message"), true);

assert.equal(matchesBotConfigMetaTalk("אשמח לפרטים"), false);
assert.equal(matchesBotConfigMetaTalk("היי מותק בוקר אור!"), false);
assert.equal(matchesBotConfigMetaTalk("לא מרגיש טוב"), false);
assert.equal(matchesBotConfigMetaTalk("מה החוקים בסטודיו לגבי נעליים"), false);
assert.equal(matchesBotConfigMetaTalk("אפשר לשנות את השעה של השיעור"), false);
assert.equal(matchesBotConfigMetaTalk("מה המדיניות של הביטול"), false);
assert.equal(matchesBotConfigMetaTalk("אשמח לפרטים על שיעור ניסיון"), false);

const zoeProductReply =
  "בוקר אור! 🙂 זה הצעה טובה מאוד. הגיוני להשנות לחוקיות רגילה - כך זואי לא תפתח פלואו מכירה על כל הודעה. **פעולה מוצעת:** 1. שנה את ההגדרות כך שפלואו המכירה לא יפתח. אני מוכן לשנות את זה - תגיד לי וניישם.";
assert.equal(looksLikeBotConfigMetaReply(zoeProductReply), true);
assert.equal(looksLikeBotConfigMetaReply("בשיעורי מתחילים לומדים את הבסיס."), false);
assert.equal(looksLikeBotConfigMetaReply("אשמח לעזור עם הרשמה לשיעור ניסיון"), false);

assert.equal(buildStudioScopeRedirectReply("he"), WA_STUDIO_SCOPE_REDIRECT_HE);
assert.equal(buildStudioScopeRedirectReply("en"), WA_STUDIO_SCOPE_REDIRECT_EN);

console.log("wa-bot-config-meta.test.ts: ok");
