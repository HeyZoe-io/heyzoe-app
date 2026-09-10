/**
 * מדיניות ספציפית לסטודיו: בסשן «מערכת שעות» לשלוח גם תמונה וגם לינק,
 * במקום אחד מהם. כרגע רק Apex ביקשו זאת.
 */
const SCHEDULE_CTA_IMAGE_AND_LINK_SLUGS = new Set(["apex"]);

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
