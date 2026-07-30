/**
 * פורמט לוג פנימי להודעות interactive ב־DB / תצוגת שיחות.
 * לא אמור להגיע ללקוח בוואטסאפ.
 */

export function formatInteractiveButtonsLogLine(labels: string[]): string {
  const cleanLabels = labels.map((label) => String(label ?? "").trim()).filter(Boolean);
  return cleanLabels.length > 0 ? `[כפתורים: ${cleanLabels.join(" | ")}]` : "";
}

/** מסיר שורת לוג פנימית שהמודל לעיתים מעתיק לתשובה ללקוח. */
export function stripAssistantInteractiveButtonsLog(text: string): string {
  return String(text ?? "")
    .replace(/\n?\[כפתורים:\s*[^\]]+\]\s*/gu, "\n")
    .replace(/\n?\[כפתור:\s*[^\]]+\]\s*/gu, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
