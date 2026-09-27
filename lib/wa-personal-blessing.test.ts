import assert from "node:assert/strict";
import { buildSystemPrompt } from "@/lib/business-context";
import { buildOffTopicStudioPromptRule } from "@/lib/wa-off-topic-fallback";
import {
  assistantReplyDecodesPersonalMessage,
  ensureHolidayBlessingPrefix,
  inboundBlessingWithBusinessQuestion,
  inboundLooksLikePersonalBlessing,
  pickPersonalBlessingReply,
  stripUnsolicitedHolidayTeamLine,
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

const STUDIO = "יקמה";

assert.equal(inboundLooksLikePersonalBlessing(YOM_KIPPUR_SHARE), true);
assert.equal(inboundBlessingWithBusinessQuestion(YOM_KIPPUR_SHARE), false);
assert.equal(
  pickPersonalBlessingReply(YOM_KIPPUR_SHARE, STUDIO),
  "תודה רבה! גמר חתימה טובה מכל צוות יקמה! ❤️"
);
assert.equal(inboundLooksLikePersonalBlessing("גמר חתימה טובה"), true);
assert.equal(inboundLooksLikePersonalBlessing("שנה טובה לכולם"), true);
assert.equal(pickPersonalBlessingReply("שנה טובה לכולם", STUDIO), "תודה רבה! שנה טובה מכל צוות יקמה! ❤️");
assert.equal(pickPersonalBlessingReply("צום קל לכולם", ""), "תודה רבה! צום קל מכל צוות הסטודיו! ❤️");
assert.equal(pickPersonalBlessingReply("חנוכה שמח", STUDIO), "תודה רבה! חנוכה שמח מכל צוות יקמה! ❤️");
assert.equal(pickPersonalBlessingReply("חג פסח שמח", STUDIO), "תודה רבה! חג כשר ושמח מכל צוות יקמה! ❤️");
assert.equal(pickPersonalBlessingReply("שבת שלום", STUDIO), "תודה רבה! שבת שלום מכל צוות יקמה! ❤️");
assert.equal(inboundLooksLikePersonalBlessing("מאחל יום כיפור משמעותי"), true);
assert.equal(inboundLooksLikePersonalBlessing("חג שמח, מתי אתם פתוחים?"), false);
assert.equal(inboundBlessingWithBusinessQuestion("חג שמח, מתי אתם פתוחים?"), true);
assert.equal(
  ensureHolidayBlessingPrefix("היום אנחנו פתוחים עד 21:00.", "חג שמח, מתי אתם פתוחים?", STUDIO),
  "תודה רבה! חג שמח מכל צוות יקמה! ❤️\n\nהיום אנחנו פתוחים עד 21:00."
);
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
assert.doesNotMatch(buildOffTopicStudioPromptRule(""), /גמר חתימה טובה/);
assert.doesNotMatch(buildSystemPrompt(null, "limitless", "whatsapp"), /גמר חתימה טובה/);

const GAL_INBOUND = `היי🤍
שילמתי, קבעתי טנטטיבית אבל זה מתנה. יש לה יומולדת 30 וזה מתנה.
תודה רבה🤍🙏`;
const GAL_LEAK =
  "תודה רבה! 🤍 גמר חתימה טובה מכל צוות Limitless! אני מעבירה את הפרטים של רוני לצוות.";
assert.equal(
  stripUnsolicitedHolidayTeamLine(GAL_LEAK, GAL_INBOUND),
  "אני מעבירה את הפרטים של רוני לצוות."
);
assert.equal(
  stripUnsolicitedHolidayTeamLine(
    "תודה רבה! גמר חתימה טובה מכל צוות יקמה! ❤️\n\nהיום אנחנו פתוחים עד 21:00.",
    "גמר חתימה טובה, מתי אתם פתוחים?"
  ),
  "תודה רבה! גמר חתימה טובה מכל צוות יקמה! ❤️\n\nהיום אנחנו פתוחים עד 21:00."
);

console.log("wa-personal-blessing.test.ts: ok");
