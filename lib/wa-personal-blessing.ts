/**
 * ברכת חג בלי שאלה על העסק — תשובה קבועה, בלי Claude ובלי העברה לצוות.
 * ברכה יחד עם שאלה (למשל «חג שמח, מתי אתם פתוחים?») — זואי עונה על השאלה,
 * והתשובה נפתחת באותה שורת ברכה.
 */

export const WA_PERSONAL_BLESSING_ACK_MODEL = "personal_blessing_ack";

const BUSINESS_TOPIC_RE =
  /שיעור|אימון|מנוי|כרטיסי|חבילה|הקפא|ביטול|מחיר|יומן|הרשמ|סטודיו|פתוח|סגור|מערכת\s*שעות|כתובת|lesson|class|membership|schedule|абонемент|заняти|расписан/iu;

const BLESSING_RE =
  /גמר\s*חתימה|שנה\s*טובה|חג\s*שמח|חג\s*כשר|צום\s*קל|שבת\s*שלום|שבוע\s*טוב|ראש\s*השנה|יום\s*כיפור|סוכות|שמחת\s*תורה|חנוכה|פורים|פסח|שבועות|מזל\s*טוב|יום\s*הולדת|happy\s+holidays|happy\s+new\s+year|shana\s+tova|gmar\s+chatima/iu;

export function inboundIsBusinessTopic(raw: string): boolean {
  return BUSINESS_TOPIC_RE.test(String(raw ?? ""));
}

/** שאלה תפעולית קצרה, לא שאלות רטוריות בתוך דבר תורה ארוך. */
export function looksLikeOperationalQuestion(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length > 400) return false;
  if (!/[?؟]/.test(t)) return false;
  return /מתי|איפה|היכן|כמה|אפשר|ניתן|יש\s+ל(?:כם|ך)|האם|איך|פתוח|סגור|שעות|להגיע|להירשם|עובד|when|where|how much|open\b/iu.test(
    t
  );
}

/** ברכה או שיתוף חג, בלי שאלה על העסק. */
export function inboundLooksLikePersonalBlessing(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length > 4000) return false;
  if (inboundIsBusinessTopic(t) || looksLikeOperationalQuestion(t)) return false;
  return BLESSING_RE.test(t);
}

/** ברכת חג וגם שאלה שצריך לענות עליה. */
export function inboundBlessingWithBusinessQuestion(raw: string): boolean {
  if (!pickHolidayBlessing(raw)) return false;
  return inboundIsBusinessTopic(raw) || looksLikeOperationalQuestion(raw);
}

/** הברכה עצמה, בלי מעטפת. null אם אין חג או ברכה מזוהים. */
export function pickHolidayBlessing(raw: string): string | null {
  const t = String(raw ?? "");
  if (/גמר\s*חתימה|gmar\s+chatima/iu.test(t)) return "גמר חתימה טובה";
  if (/צום\s*קל/u.test(t)) return "צום קל";
  if (/יום\s*כיפור/u.test(t)) return "גמר חתימה טובה";
  if (/שנה\s*טובה|ראש\s*השנה|shana\s+tova|happy\s+new\s+year/iu.test(t)) return "שנה טובה";
  if (/פסח|חג\s*כשר/u.test(t)) return "חג כשר ושמח";
  if (/חנוכה/u.test(t)) return "חנוכה שמח";
  if (/פורים/u.test(t)) return "פורים שמח";
  if (/סוכות|שמחת\s*תורה/u.test(t)) return "חג סוכות שמח";
  if (/שבועות/u.test(t)) return "חג שבועות שמח";
  if (/שבת\s*שלום/u.test(t)) return "שבת שלום";
  if (/שבוע\s*טוב/u.test(t)) return "שבוע טוב";
  if (/מזל\s*טוב|יום\s*הולדת/u.test(t)) return "מזל טוב";
  if (/חג\s*שמח|happy\s+holidays/iu.test(t)) return "חג שמח";
  return null;
}

export function pickPersonalBlessingReply(raw: string, studioName: string): string {
  const blessing = pickHolidayBlessing(raw) ?? "חג שמח";
  const name = String(studioName ?? "").trim() || "הסטודיו";
  return `תודה רבה! ${blessing} מכל צוות ${name}! ❤️`;
}

/** מוסיפה את שורת הברכה לפני מענה על שאלה שנשלחה יחד איתה. */
export function ensureHolidayBlessingPrefix(reply: string, raw: string, studioName: string): string {
  const line = pickPersonalBlessingReply(raw, studioName);
  const body = String(reply ?? "").trim();
  if (!body) return line;
  if (body.startsWith(line) || (body.startsWith("תודה רבה!") && body.includes("מכל צוות"))) return body;
  return `${line}\n\n${body}`;
}

export function buildHolidayQuestionPromptRule(raw: string, studioName: string): string {
  if (!inboundBlessingWithBusinessQuestion(raw)) return "";
  const line = pickPersonalBlessingReply(raw, studioName);
  return `- ההודעה כוללת ברכת חג וגם שאלה על העסק. אל תפענחי את הברכה ואל תעבירי לצוות בגללה. עני על השאלה מהידע. פתחי בדיוק: «${line}» ואז התשובה.`;
}

/**
 * תשובת מודל שמפענחת את ההודעה ללקוח (ציטוט, «אני בוט», שיעור חיים)
 * במקום להשיב בשורה אחת.
 */
export function assistantReplyDecodesPersonalMessage(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (t.length < 160) return false;
  if (/אני בוט/.test(t)) return true;
  if (/הודעה (?:אישית|יפה|מעמיקה)/.test(t)) return true;
  if (/אין לי ["״']?יעוד|אין לי נשמה/.test(t)) return true;
  const bullets = t.match(/^[-•]\s/gm) ?? [];
  if (bullets.length >= 2 && /מודעות|יעוד|חשבון נפש/.test(t)) return true;
  return false;
}
