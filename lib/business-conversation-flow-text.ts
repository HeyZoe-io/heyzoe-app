import { isSalesFlowStartTrigger } from "@/lib/sales-flow-start-triggers";

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

/**
 * «אשמח לפרטים» / «בואו נתחיל» פותחים את מסלול השיחה מהנוד הראשון,
 * גם אחרי סיום המסלול וגם כשמחכים לתשובה פתוחה.
 * לחיצה על כפתור שזה בדיוק הטקסט שלו נשארת תשובה לשאלה הנוכחית.
 */
export function inboundRestartsBusinessFlowFromStart(input: {
  text: string;
  businessSlug?: string;
  currentQuestionButtons?: string[];
}): boolean {
  if (!isSalesFlowStartTrigger(input.text, { slug: input.businessSlug })) return false;
  const want = normalizeFlowAnswer(input.text);
  const buttons = input.currentQuestionButtons ?? [];
  const matchesCurrentButton = buttons.some((label) => normalizeFlowAnswer(label) === want);
  return !matchesCurrentButton;
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
