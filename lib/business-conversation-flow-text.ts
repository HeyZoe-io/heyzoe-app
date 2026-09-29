export type ConversationCapture = "none" | "day" | "time";

export function fillRegistrationText(input: {
  template: string;
  productName: string;
  day: string;
  time: string;
}): string {
  const product = input.productName.trim() || "האימון";
  const day = input.day.trim() || "היום שנבחר";
  const time = input.time.trim() || "השעה שנבחרה";
  return input.template
    .replaceAll("{מוצר}", product)
    .replaceAll("{יום}", day)
    .replaceAll("{שעה}", time)
    .trim();
}

export function normalizeFlowAnswer(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[“”״"']/g, "")
    .replace(/\s+/g, " ");
}

/** התאמה לכפתור שאלה לפי הטקסט שהליד שלח או לחץ. */
export function matchQuestionButton(buttons: string[], answer: string): number {
  const want = normalizeFlowAnswer(answer);
  if (!want) return -1;
  const labels = buttons.map((b) => normalizeFlowAnswer(b));
  const exact = labels.findIndex((label) => label && label === want);
  if (exact >= 0) return exact;
  return labels.findIndex((label) => label && (want.includes(label) || label.includes(want)));
}
