/** טקסטי ברירת מחדל למעקב אחרי שתיקה בווטסאפ (20 דק׳ / 2 שעות / 23 שעות). {{bot_name}}, {{business_name}}, {{phone}} ב־2–3, {{service_phone_note}} ב־1 (מותנה: נוסף רק אם לעסק יש טלפון תצוגה) */

export const WA_SALES_FOLLOWUP_1_DEFAULT =
  "היי! 😊 לפעמים ההודעות הולכות לאיבוד, אבל בונדינג חזק נשאר לנצח. להמשך שיחה ניתן ללחוץ על הכפתור הקודם מהתפריט, לשאול שאלה פתוחה, או לכתוב *אשמח לפרטים* ונתחיל מחדש.{{service_phone_note}}";

export const WA_SALES_FOLLOWUP_2_DEFAULT =
  "היי, {{bot_name}} כאן 👋 מ{{business_name}}. אני אומנם בוטית ואין לי ממש חיי חברה או עיסוקים, אבל רק מזכירה שאני עוד כאן ממתינה לתשובתך :) יש לך שאלה? אפשר לכתוב לי. לתחילת שיחה חדשה יש לכתוב *אשמח לפרטים*";

export const WA_SALES_FOLLOWUP_3_DEFAULT =
  "הולה! זו {{bot_name}} מ{{business_name}} 🌟 זו הפעם האחרונה שאני אצור איתך קשר - כדי לא להטריד😊 אם יש בך רצון להתאהב בשגרת האימונים החדשה שלך, אני כאן כדי לגרום לזה לקרות. אפשר לשאול אותי כל שאלה או להרים טלפון ישירות למספר {{phone}} אנחנו כאן בשבילך! שיהיה המשך יום קסום.";

function asSocialRecord(social: unknown): Record<string, unknown> {
  if (!social || typeof social !== "object" || Array.isArray(social)) return {};
  return social as Record<string, unknown>;
}

export function resolveWaSalesFollowupTemplates(social: unknown): {
  t1: string;
  t2: string;
  t3: string;
} {
  const sl = asSocialRecord(social);
  const pick = (key: "wa_sales_followup_1" | "wa_sales_followup_2" | "wa_sales_followup_3", fallback: string) => {
    const v = sl[key];
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  };
  return {
    t1: pick("wa_sales_followup_1", WA_SALES_FOLLOWUP_1_DEFAULT),
    t2: pick("wa_sales_followup_2", WA_SALES_FOLLOWUP_2_DEFAULT),
    t3: pick("wa_sales_followup_3", WA_SALES_FOLLOWUP_3_DEFAULT),
  };
}
