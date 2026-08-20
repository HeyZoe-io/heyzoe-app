import { ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY } from "@/lib/wa-unknown-knowledge-handoff";
import {
  WA_UNCLEAR_CLARIFY_EN,
  WA_UNCLEAR_CLARIFY_HE,
  WA_UNCLEAR_HANDOFF_EN,
  WA_UNCLEAR_HANDOFF_HE,
} from "@/lib/wa-unclear-intent";

/** תשובה קבועה כשההודעה לא קשורה לעסק (לא שיעורים / מחירים / הרשמה וכו'). */
export function buildOffTopicStudioFallbackReply(_customerServicePhone: string): string {
  return WA_UNCLEAR_CLARIFY_HE;
}

export function buildOffTopicStudioFallbackReplyEn(_customerServicePhone: string): string {
  return WA_UNCLEAR_CLARIFY_EN;
}

/** כלל לפרומפט: קודם ידע העסק; נושא בלי סמכות — לצוות, לא חזרה לאימוני ניסיון. */
export function buildOffTopicStudioPromptRule(_customerServicePhone: string): string {
  return `- קודם כל: אם יש בידע העסקי משהו שעונה על השאלה (תיאור העסק / «על העסק», עובדות, FAQ, שירותים, שעות, כתובת, מדיניות) - עני מתוך הידע. אל תשתמשי בנוסח «לא הבנתי» במקרה כזה.
- שאלה שכן קשורה לעסק/סטודיו אבל אין עליה מספיק מידע בידע - חוסר ידע: עני רק «${ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY}». לא נוסח «לא הבנתi».
- נושא שאין לך סמכות או יכולת לטפל בו (קבלה/חשבונית, דרושים/משרות, שליחת מסמך לצוות, תפעול פנימי, או כל דבר שלא קשור לאימונים/מנויים/הרשמה שאת יודעת לענות עליו) — עני רק: «אין בעיה אעביר את ההודעה לצוות!». אסור להחזיר את השיחה לאימוני ניסיון או מנויים (אסור «אני פה כדי לעזור בנושאים של האימונים…»). המערכת שולחת התראת נציג.
- אם לא הבנת עד הסוף למה הליד מתכוון, או שההודעה לא זוהתה כקשורה לעסק (סימולציה, משחק תפקידים, בדיקת בוט) - אל תשתפי פעולה ואל תמשיכי את המשחק. פעם ראשונה בשיחה עני רק: «${WA_UNCLEAR_CLARIFY_HE}» (EN: «${WA_UNCLEAR_CLARIFY_EN}»). אם כבר ביקשת ניסוח מחדש ועדיין לא ברור — רק: «${WA_UNCLEAR_HANDOFF_HE}» (EN: «${WA_UNCLEAR_HANDOFF_EN}»). בלי שאלת «יש עוד משהו», בלי «מה תשלחי».`;
}
