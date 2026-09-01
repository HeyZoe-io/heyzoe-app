import { pickByDetectedLanguage, type DetectedMessageLanguage } from "@/lib/language-detect";

/** נושא שזואי לא מטפלת בו — העברה לצוות, בלי להחזיר לאימוני ניסיון. */
export const WA_OUT_OF_SCOPE_HANDOFF_REPLY_HE = "אין בעיה אעביר את ההודעה לצוות!";
export const WA_OUT_OF_SCOPE_HANDOFF_REPLY_EN = "No problem — I'll pass the message to the team!";
export const WA_OUT_OF_SCOPE_HANDOFF_REPLY_RU = "Без проблем, передам сообщение команде!";
export const WA_OUT_OF_SCOPE_HANDOFF_MODEL = "out_of_scope_team_handoff";

export function buildOutOfScopeTeamHandoffReply(lang?: DetectedMessageLanguage): string {
  return pickByDetectedLanguage(lang, {
    he: WA_OUT_OF_SCOPE_HANDOFF_REPLY_HE,
    en: WA_OUT_OF_SCOPE_HANDOFF_REPLY_EN,
    ru: WA_OUT_OF_SCOPE_HANDOFF_REPLY_RU,
  });
}

function normalizeScopeText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * קבלה/חשבונית, דרושים, שליחת מסמך לצוות — לא שיעור/מנוי/הרשמה שזואי יודעת לענות עליהם.
 */
export function matchesOutOfScopeTeamHandoff(raw: string): boolean {
  const t = normalizeScopeText(raw);
  if (!t || t.length > 1200) return false;

  const hiring =
    /מחפש(?:ים|ות)?\s+עובד|דרושים|דרושות|דרוש(?:ה)?\s+עובד|משרה(?:\s|$)|קורות\s*חיים|\bhiring\b|\bjob\s+opening\b|we['’]?re\s+hiring/iu.test(
      t
    );
  const invoice =
    /קבלה|חשבונית|קוח\s+מעודכן|חשבונית\s+מס|\binvoice\b|\breceipt\b/iu.test(t);
  const sendDoc =
    /אשלח\s+לך.{0,48}(?:קבלה|חשבונית|קוח|מסמך|קובץ|צילום)/iu.test(t) ||
    /(?:קבלה|חשבונית|קוח|מסמך|קובץ).{0,24}אשלח/iu.test(t);

  return hiring || invoice || sendDoc;
}

/** קלוד החזירה את השיחה לאימונים/מנויים במקום להעביר לצוות. */
export function assistantReplySteersBackToStudioScope(raw: string): boolean {
  const t = normalizeScopeText(raw);
  if (!t) return false;
  if (/בנושאים של האימונים והשירותים/.test(t)) return true;
  if (/אימוני ניסיון,\s*מנויים/.test(t)) return true;
  if (/קשור להתחלה איתנו/.test(t)) return true;
  if (/אני פה כדי לעזור בנושאים/.test(t)) return true;
  if (/אם יש לך שאלות על אימונ/.test(t) && /אני כאן לעזור/.test(t)) return true;
  if (
    /here to help with (?:our )?(?:classes|workouts|training|memberships)/i.test(t) &&
    /trial|membership|studio/i.test(t)
  ) {
    return true;
  }
  return false;
}
