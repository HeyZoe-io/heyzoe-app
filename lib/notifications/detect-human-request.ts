/** זיהוי בקשת מענה אנושי / נציג (זהה ללוגיקה בפלואו שיווקי) */
export function userRequestedHumanAgent(userText: string): boolean {
  const raw = String(userText ?? "").trim();
  if (!raw) return false;
  const t = raw.toLowerCase();
  const hebrew =
    /נציג|נציגה|בן\s*אדם|אדם\s*אמיתי|מענה\s*אנושי|דברו\s*איתי|לדבר\s*עם\s*מישהו|לדבר\s*עם\s*אדם|העבר(ה|י)\s*ל|תחבר(ו|י)\s*אותי|אפשר\s*לדבר\s*עם|מישהו\s*אמיתי|נציג\s*אנושי|שירות\s*אנושי|לא\s*רובוט|לא\s*בוט|עם\s*בשר\s*ודם|(אני\s*)?(רוצה|צריך|צריכה|מעוניין|מעוניינת|מבקש|מבקשת).{0,50}שירות\s*לקוחות|שירות\s*לקוחות.{0,20}(בבקשה|עכשיו)/i.test(
      raw
    );
  const english =
    /\b(human|agent|representative|real\s*person|customer\s*service|talk\s*to\s*(a\s*)?(human|person|someone)|speak\s*to\s*(a\s*)?(human|person))\b/i.test(
      t
    );
  return hebrew || english;
}

/** נוסח קבוע לליד בפלואו מכירה — לפני Claude, לפי טלפון שירות לקוחות מהדשבורד. */
export function buildSalesFlowHumanAgentHandoffReply(customerServicePhone: string): string {
  const phone = String(customerServicePhone ?? "").trim();
  if (phone) {
    return `אין בעיה! 😊 נציג אנושי יחזור אליכם בהקדם. לתיאום מיידי תוכלו גם להתקשר ישירות: ${phone}`;
  }
  return "אין בעיה! 😊 השארתם פנייה ונציג אנושי יחזור אליכם בהקדם.";
}
