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

/** כלל לפרומפט - עדיפות על שיתוף פעולה / סימולציה / בדיקת בוט. */
export function buildOffTopicStudioPromptRule(customerServicePhone: string): string {
  const he = buildOffTopicStudioFallbackReply(customerServicePhone);
  const en = buildOffTopicStudioFallbackReplyEn(customerServicePhone);
  return `- עני רק על נושאים שקשורים לעסק: שיעורים, אימונים, מחירים, הרשמה, ניסיון, שעות, מיקום, מדריכים, מדיניות, ציוד, חניה, ומה שיש בידע העסקי.
- הודעה שלא קשורה לעסק - כולל סימולציה, משחק תפקידים, «תתנהגי כלקוחה», בדיקת בוט/השהיה/הגדרות, או נושא כללי - אל תשתפי פעולה ואל תמשיכי את המשחק.
- במקרים האלה עני רק בנוסח הזה (עברית), או תרגום לאותה משמעות בשפת הלקוח (אנגלית למטה). בלי שאלת המשך, בלי «מה תשלחי», בלי הצעה לסימולציה:
  עברית: «${he}»
  English: «${en}»`;
}
