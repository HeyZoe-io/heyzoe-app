/**
 * מדיניות ספציפית לסטודיו: בסשן «מערכת שעות» לשלוח גם תמונה וגם לינק,
 * במקום אחד מהם. כרגע רק Apex ביקשו זאת.
 */
const SCHEDULE_CTA_IMAGE_AND_LINK_SLUGS = new Set(["apex"]);

/**
 * במקום לפרט מועדי אימונים בטקסט — תמונת מערכת שעות עם המשפט הזה.
 * כרגע רק סטודיו טייץ.
 */
const SCHEDULE_TIMES_IMAGE_REPLY_SLUGS = new Set(["tights"]);

export const SCHEDULE_TIMES_IMAGE_REPLY =
  "אפשר לראות במערכת שעות! זה עונה על השאלה שלך?";

export function scheduleTimesReplyUsesImage(slug?: string | null): boolean {
  const s = String(slug ?? "").trim().toLowerCase();
  return Boolean(s) && SCHEDULE_TIMES_IMAGE_REPLY_SLUGS.has(s);
}

export function scheduleTimesReplyCaption(slug?: string | null): string | null {
  return scheduleTimesReplyUsesImage(slug) ? SCHEDULE_TIMES_IMAGE_REPLY : null;
}

/**
 * תשובה שמפרטת מועדי אימונים (יום/שעה), לא אישור הרשמה ולא שעות פעילות.
 * משמש כדי להחליף את הרשימה בתמונת מערכת השעות.
 */
export function assistantReplyListsClassTimes(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (/נרשמ|נתראה|שיריינ|ההרשמה בוצעה|נרשמת/u.test(raw)) return false;
  if (
    /שעות פעילות|אנחנו פתוחים|הסטודיו פתוח|סגורים היום/u.test(raw) &&
    !/אימון|שיעור|מערכת שעות/u.test(raw)
  ) {
    return false;
  }
  const times = raw.match(/\d{1,2}:\d{2}/g) ?? [];
  if (!times.length) return false;
  const hasDay = /היום|מחר|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת/u.test(raw);
  const scheduleVoice = /מתקיים|מועד|מערכת|לוח|אימון|שיעור|ביום/u.test(raw);
  if (/ביום\s+\S+\s+ב-\d{1,2}:\d{2}/u.test(raw)) return true;
  if (/\|\s*(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|היום|מחר)/u.test(raw)) return true;
  const linesWithTime = raw.split(/\n/).filter((line) => /\d{1,2}:\d{2}/.test(line));
  if (linesWithTime.length >= 2) return true;
  if (times.length >= 2 && (hasDay || scheduleVoice)) return true;
  if (times.length === 1 && hasDay) return true;
  return false;
}

/** האם לצרף לינק למערכת השעות מיד אחרי תמונת מערכת השעות. */
export function scheduleCtaSendsImageAndLink(slug?: string | null): boolean {
  const s = String(slug ?? "").trim().toLowerCase();
  return Boolean(s) && SCHEDULE_CTA_IMAGE_AND_LINK_SLUGS.has(s);
}

/** נוסח הודעת הלינק שנשלחת אחרי התמונה (כשהמדיניות פעילה ויש לינק). */
export function scheduleCtaImageFollowUpLinkText(link: string): string {
  const l = String(link ?? "").trim();
  if (!l) return "";
  return `וגם הקישור הישיר למערכת השעות:\n${l}`;
}
