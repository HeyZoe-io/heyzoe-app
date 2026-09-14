import type { KnowledgeQaPair } from "@/lib/knowledge-qa";

/**
 * ליד כותב שהמנוי שלו כרגע בהקפאה ורוצה לפעול על כך (לבטל/להסיר כדי להירשם) —
 * זואי לא יכולה לבדוק או לשנות סטטוס הקפאה של ליד ספציפי, אז זו לא בקשת מדיניות כללית
 * (כמו «אפשר להקפיא?») אלא בקשה שדורשת בדיקה מול הצוות.
 */
export const FREEZE_ACTION_HANDOFF_REPLY =
  "אני מבינה שיש צורך לטפל בהקפאה אבל אני לא יכולה לעשות זאת בעצמי אז אני מעבירה לצוות שיצרו איתך קשר, סבבה?";

export const FREEZE_ACTION_HANDOFF_MODEL = "freeze_action_team_handoff";

function normalizeFreezeActionBlob(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * ליד מציין שהמנוי שלו כרגע בהקפאה, או מבקש לבטל/להסיר הקפאה קיימת.
 * שאלת מדיניות כללית («אפשר להקפיא?», «כמה זמן אפשר להקפיא?») לא נחשבת.
 */
export function isFreezeActionRequest(text: string): boolean {
  const t = normalizeFreezeActionBlob(text);
  if (!t || t.length > 1200) return false;
  if (!/הקפא/u.test(t)) return false;

  const statesActiveFreeze =
    /(?:מנוי|כרטיסיה|כרטיסייה)[^.!?\n]{0,20}(?:ב|היא ב|הוא ב)הקפאה|בהקפאה|הקפאה\s+פעיל(?:ה)?/u.test(t);
  const wantsToCancelFreeze =
    /לבטל\s+(?:את\s+)?ה?הקפאה|להסיר\s+(?:את\s+)?ה?הקפאה|לצאת\s+מ?ה?הקפאה/u.test(t);

  return statesActiveFreeze || wantsToCancelFreeze;
}

/**
 * בודקת אם יש בידע העסקי («ידע לזואי») הנחיה ספציפית לטיפול בפעולת הקפאה
 * (איך לבטל/להסיר הקפאה קיימת) — לא רק עובדת מדיניות כללית כמו משך ההקפאה המותר.
 */
export function hasBusinessFreezeActionKnowledge(
  pairs: KnowledgeQaPair[] | undefined | null
): boolean {
  if (!Array.isArray(pairs)) return false;
  return pairs.some((p) => {
    const blob = `${String(p?.question ?? "")} ${String(p?.answer ?? "")}`;
    if (!/הקפא/u.test(blob)) return false;
    return /לבטל\s+(?:את\s+)?ה?הקפאה|להסיר\s+(?:את\s+)?ה?הקפאה|לצאת\s+מ?ה?הקפאה/u.test(blob);
  });
}
