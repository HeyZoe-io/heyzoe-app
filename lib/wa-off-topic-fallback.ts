/** תשובה קבועה כשההודעה לא קשורה לעסק (לא שיעורים / מחירים / הרשמה וכו'). */
export function buildOffTopicStudioFallbackReply(customerServicePhone: string): string {
  const phone = String(customerServicePhone ?? "").trim();
  if (phone) {
    return `אני לא בטוחה שהבנתי. אפשר לנסות לנסח לי מחדש, או ליצור קשר עם שירות הלקוחות שלנו ${phone}`;
  }
  return "אני לא בטוחה שהבנתי. אפשר לנסות לנסח לי מחדש.";
}

export function buildOffTopicStudioFallbackReplyEn(customerServicePhone: string): string {
  const phone = String(customerServicePhone ?? "").trim();
  if (phone) {
    return `I'm not sure I understood. You can try rephrasing, or contact our customer service at ${phone}`;
  }
  return "I'm not sure I understood. You can try rephrasing.";
}

/** כלל לפרומפט: קודם ידע העסק; הפניית «לא הבנתי» רק כשזה לא קשור לסטודיו ואין מידע. */
export function buildOffTopicStudioPromptRule(customerServicePhone: string): string {
  const he = buildOffTopicStudioFallbackReply(customerServicePhone);
  const en = buildOffTopicStudioFallbackReplyEn(customerServicePhone);
  return `- קודם כל: אם יש בידע העסקי משהו שעונה על השאלה (תיאור העסק / «על העסק», עובדות, FAQ, שירותים, שעות, כתובת, מדיניות) - עני מתוך הידע. אל תשתמשי בנוסח «לא הבנתי» במקרה כזה.
- שאלה שכן קשורה לעסק/סטודיו אבל אין עליה מספיק מידע בידע - זה חוסר ידע רגיל (אין לי את הפרטים + טלפון שירות לקוחות אם מוגדר). לא נוסח «לא הבנתי».
- רק אם גם לא מצאת מידע בידע וגם לא זיהית שההודעה קשורה לעסק (סימולציה, משחק תפקידים, «תתנהגי כלקוחה», בדיקת בוט/השהיה, או נושא זר לגמרי) - אל תשתפי פעולה ואל תמשיכי את המשחק. עני רק בנוסח הזה (או אותה משמעות בשפת הלקוח). בלי שאלת המשך, בלי «מה תשלחי»:
  עברית: «${he}»
  English: «${en}»`;
}
