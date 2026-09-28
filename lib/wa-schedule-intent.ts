/**
 * בקשה ללוח/מערכת שעות של הסטודיו (לינק או תמונה) — לא שאלה על מועדי מוצר ספציפי.
 * כשאין לוח מוגדר, «אין מערכת / תתעדכן בקרוב» זה בסדר.
 */
export function looksLikeScheduleBoardAsk(text: string): boolean {
  const n = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[!.,?;:~'"`\-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!n) return false;
  return (
    n.includes("מערכת שעות") ||
    n.includes("מערכת השעות") ||
    n.includes("לוח שיעורים") ||
    n.includes("לוח הזמנים") ||
    n.includes("לוח זמנים") ||
    n.includes("צפייה במערכת") ||
    (n.includes("שוב") && n.includes("מערכת"))
  );
}

/** זיהוי בקשה ללוח שעות / מערכת שעות (טקסט חופשי, לא רק לחיצה על כפתור). */
export function isScheduleIntent(text: string): boolean {
  const n = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[!.,?;:~'"`\-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!n) return false;
  if (looksLikeScheduleBoardAsk(n)) return true;
  const asksWhen =
    n.includes("מתי") || n.includes("מתי אפשר") || n.includes("מתי ניתן") || n.includes("איזה ימים");
  const arrival =
    n.includes("להגיע") || n.includes("לבוא") || n.includes("להגיע לשיעור") || n.includes("לבוא לשיעור");
  const classish = n.includes("שיעור") || n.includes("אימון") || n.includes("ניסיון") || n.includes("יוגה");
  return (
    n.includes("מתי השיעורים") ||
    n.includes("מתי יש שיעור") ||
    n.includes("מתי יש אימון") ||
    n.includes("מתי מתקיימ") ||
    n.includes("מתי ניתן להגיע") ||
    n.includes("מתי אפשר להגיע") ||
    n.includes("מתי אפשר לבוא") ||
    n.includes("שעות השיעורים") ||
    n.includes("שעות האימונים") ||
    (asksWhen && arrival && classish) ||
    (n.includes("שעות") && (n.includes("שיעור") || n.includes("אימון") || n.includes("יוגה")))
  );
}
