/** בלבול בהקפאה/חיוב על מנוי קיים — לא מדיניות כללית, לא מנחשים. */
export const FREEZE_BILLING_HANDOFF_REPLY =
  "מצטערת לשמוע שיש בלבול עם ההקפאה! אני מעבירה את זה לבדיקה מול הצוות. בינתיים אם יש שאלות או דברים נוספים שאני יכולה לעזור בהם - אני כאן! 💜";

export const FREEZE_BILLING_HANDOFF_MODEL = "freeze_billing_team_handoff";

function normalizeFreezeBlob(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * תלונה על הקפאה שלא בוצעה / חיוב בתקופת הקפאה שביקשו.
 * שאלת מדיניות כללית («אפשר להקפיא?») לא נחשבת.
 */
export function isFreezeBillingAccountDispute(text: string): boolean {
  const t = normalizeFreezeBlob(text);
  if (!t || t.length > 1200) return false;
  if (!/הקפא/u.test(t)) return false;
  const hasCharge = /תשלום|חיוב|חויב|חוייב|ירד\s+לי|נגבה|גבו\s+לי/u.test(t);
  const personalCharge = /ירד\s+לי|חויב(?:תי|ה)|חוייב|נגבה|גבו\s+לי/u.test(t);
  const notApplied = /לא\s+הקפא/u.test(t);
  const askedFreeze = /ביקשתי.{0,48}הקפא|הקפא(?:תי|נו|ת).{0,48}ביקשתי|הקפא(?:תי|נו)/u.test(t);
  const confusion = /בלבול|טעות|(?:למה|מדוע).{0,24}(?:ירד|חויב|תשלום)/u.test(t);
  if (personalCharge) return true;
  if (hasCharge && (notApplied || askedFreeze || confusion)) return true;
  if (notApplied && /מנוי/u.test(t)) return true;
  return false;
}
