/**
 * ברכת חג / שיתוף אישי שנשלח לקו העסק — לא שאלה.
 * זואי מהדהדת את הברכה בשורה אחת. אסור לפענח ציטוט, גמרא או דבר תורה.
 * בלי קריאת Claude: ביום חג זה פרץ הודעות, וכל פענוח הוא קריאה מיותרת.
 */

export const WA_PERSONAL_BLESSING_ACK_MODEL = "personal_blessing_ack";

const BUSINESS_TOPIC_RE =
  /שיעור|אימון|מנוי|כרטיסי|חבילה|הקפא|ביטול|מחיר|יומן|הרשמ|סטודיו|פתוח|סגור|מערכת\s*שעות|כתובת|lesson|class|membership|schedule|абонемент|заняти|расписан/iu;

const BLESSING_RE =
  /גמר\s*חתימה|שנה\s*טובה|חג\s*שמח|חג\s*כשר|צום\s*קל|שבת\s*שלום|ראש\s*השנה|מזל\s*טוב|יום\s*הולדת|חנוכה\s*שמח|פורים\s*שמח|happy\s+holidays|happy\s+new\s+year|shana\s+tova|gmar\s+chatima/iu;

export function inboundIsBusinessTopic(raw: string): boolean {
  return BUSINESS_TOPIC_RE.test(String(raw ?? ""));
}

/** ברכה או שיתוף חג, בלי שאלה על העסק. */
export function inboundLooksLikePersonalBlessing(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length > 4000) return false;
  if (inboundIsBusinessTopic(t)) return false;
  return BLESSING_RE.test(t);
}

export function pickPersonalBlessingReply(raw: string): string {
  const t = String(raw ?? "");
  if (/גמר\s*חתימה|gmar\s+chatima/iu.test(t)) return "גמר חתימה טובה 🙏";
  if (/שנה\s*טובה|ראש\s*השנה|shana\s+tova|happy\s+new\s+year/iu.test(t)) return "שנה טובה 🙏";
  if (/צום\s*קל/u.test(t)) return "צום קל 🙏";
  if (/שבת\s*שלום/u.test(t)) return "שבת שלום 🙏";
  if (/חג\s*שמח|חג\s*כשר|חנוכה\s*שמח|פורים\s*שמח|happy\s+holidays/iu.test(t)) return "חג שמח 🙏";
  if (/מזל\s*טוב|יום\s*הולדת/u.test(t)) return "מזל טוב 🙏";
  return "תודה 🙏";
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
