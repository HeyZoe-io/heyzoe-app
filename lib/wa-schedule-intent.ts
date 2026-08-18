/** זיהוי בקשה ללוח שעות / מערכת שעות (טקסט חופשי, לא רק לחיצה על כפתור). */
export function isScheduleIntent(text: string): boolean {
  const n = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[!.,?;:~'"`\-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!n) return false;
  const asksWhen =
    n.includes("מתי") || n.includes("מתי אפשר") || n.includes("מתי ניתן") || n.includes("איזה ימים");
  const arrival =
    n.includes("להגיע") || n.includes("לבוא") || n.includes("להגיע לשיעור") || n.includes("לבוא לשיעור");
  const classish = n.includes("שיעור") || n.includes("אימון") || n.includes("ניסיון") || n.includes("יוגה");
  return (
    n.includes("מערכת שעות") ||
    n.includes("מערכת השעות") ||
    n.includes("לוח שיעורים") ||
    n.includes("לוח הזמנים") ||
    n.includes("לוח זמנים") ||
    n.includes("מתי השיעורים") ||
    n.includes("מתי יש שיעור") ||
    n.includes("מתי יש אימון") ||
    n.includes("מתי מתקיימ") ||
    n.includes("מתי ניתן להגיע") ||
    n.includes("מתי אפשר להגיע") ||
    n.includes("מתי אפשר לבוא") ||
    n.includes("שעות השיעורים") ||
    n.includes("שעות האימונים") ||
    n.includes("צפייה במערכת") ||
    (asksWhen && arrival && classish) ||
    (n.includes("שעות") && (n.includes("שיעור") || n.includes("אימון") || n.includes("יוגה"))) ||
    (n.includes("שוב") && n.includes("מערכת"))
  );
}
