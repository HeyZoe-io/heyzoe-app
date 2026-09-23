import { normalizeMarketingInboundText } from "@/lib/marketing-whatsapp";

/** כפתור טמפלייט שפותח את קביעת השיחה מאמצע הפלואו. */
export const MARKETING_SCHEDULE_CALL_BUTTON = "קביעת שיחה";

const WEEKDAY_BUTTON =
  /היום|מחר|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת/;

export type ScheduleFlowNode = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

export function isMarketingScheduleCallButton(text: string): boolean {
  return normalizeMarketingInboundText(text) === MARKETING_SCHEDULE_CALL_BUTTON;
}

function nodeText(node: ScheduleFlowNode): string {
  return normalizeMarketingInboundText(String(node.data.text ?? ""));
}

function nodeButtons(node: ScheduleFlowNode): string[] {
  const raw = node.data.buttons;
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => normalizeMarketingInboundText(String(b ?? ""))).filter(Boolean);
}

/** שאלה של «באיזה יום נוח…». ציון 0 = לא הנוד הזה. */
export function marketingScheduleDayNodeScore(node: ScheduleFlowNode): number {
  if (node.type !== "question") return 0;
  const text = nodeText(node);
  const asksDay = /יום/.test(text) && /נוח|לדבר|שיחה/.test(text);
  const weekdayButtons = nodeButtons(node).filter((b) => WEEKDAY_BUTTON.test(b)).length;
  let score = 0;
  if (asksDay) score += 10;
  if (weekdayButtons >= 2) score += weekdayButtons;
  return score;
}

export function findMarketingScheduleDayNode<T extends ScheduleFlowNode>(nodes: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const node of nodes) {
    const score = marketingScheduleDayNodeScore(node);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}
