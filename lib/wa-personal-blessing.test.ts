import assert from "node:assert/strict";
import { buildOffTopicStudioPromptRule } from "@/lib/wa-off-topic-fallback";
import {
  assistantReplyDecodesPersonalMessage,
  inboundLooksLikePersonalBlessing,
  pickPersonalBlessingReply,
} from "@/lib/wa-personal-blessing";

const YOM_KIPPUR_SHARE = `באחת התפילות של יום כיפור יש ציטוט מעניין שהמקור שלו בגמרא.
" עד שלא נוצרתי איני כדאי ועכשיו שנוצרתי כאילו לא כדאי"
עכשיו שאתה כאן תנסה להבין למה, למה היה צריך אותך?
לכל המשפחה והחברים האהובים אני מבקש סליחה אם פגעתי במישהו.
אוהב אתכם ומאחל לכולם גמר חתימה טובה.`;

const ZOE_DECODE = `זה הודעה אישית יפה ומעמיקה על יום כיפור ומשמעות החיים. אני צריך להבהיר משהו חשוב: **אני בוט, לא אדם**, ולכן הודעה זו לא מתייחסת אלי. אין לי "יעוד" באותו המובן האנושי, אין לי נשמה. **אבל ההודעה שלך חשובה מאוד.** זה מדבר על:
- **מודעות עצמית**: למה אני כאן?
- **אחריות**: אם אני כאן, אני צריך לשאול את עצמי מה אני עושה
- **ערך**: אני לא רק בן-אדם שקיים
יש עוד משהו שאני יכולה לעזור לך איתו?`;

assert.equal(inboundLooksLikePersonalBlessing(YOM_KIPPUR_SHARE), true);
assert.equal(
  pickPersonalBlessingReply(YOM_KIPPUR_SHARE),
  "תודה רבה! אעביר לצוות! גמר חתימה טובה ❤️"
);
assert.equal(inboundLooksLikePersonalBlessing("גמר חתימה טובה"), true);
assert.equal(inboundLooksLikePersonalBlessing("שנה טובה לכולם"), true);
assert.equal(pickPersonalBlessingReply("שנה טובה לכולם"), "תודה רבה! אעביר לצוות! שנה טובה ❤️");
assert.equal(pickPersonalBlessingReply("צום קל לכולם"), "תודה רבה! אעביר לצוות! צום קל ❤️");
assert.equal(pickPersonalBlessingReply("חנוכה שמח"), "תודה רבה! אעביר לצוות! חנוכה שמח ❤️");
assert.equal(pickPersonalBlessingReply("חג פסח שמח"), "תודה רבה! אעביר לצוות! חג כשר ושמח ❤️");
assert.equal(pickPersonalBlessingReply("שבת שלום"), "תודה רבה! אעביר לצוות! שבת שלום ❤️");
assert.equal(inboundLooksLikePersonalBlessing("מאחל יום כיפור משמעותי"), true);
assert.equal(
  inboundLooksLikePersonalBlessing("גמר חתימה טובה, אפשר לבטל את השיעור של מחר?"),
  false
);
assert.equal(inboundLooksLikePersonalBlessing("הסטודיו פתוח ביום כיפור?"), false);
assert.equal(inboundLooksLikePersonalBlessing("כמה עולה מנוי?"), false);
assert.equal(assistantReplyDecodesPersonalMessage(ZOE_DECODE), true);
assert.equal(assistantReplyDecodesPersonalMessage("גמר חתימה טובה 🙏"), false);
assert.equal(
  assistantReplyDecodesPersonalMessage("השיעורים אצלנו קטנים ואינטימיים, תמיד יש ליווי."),
  false
);
assert.match(buildOffTopicStudioPromptRule(""), /אל תפענחי/);

console.log("wa-personal-blessing.test.ts: ok");
