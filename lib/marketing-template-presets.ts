import { toPipelineTime } from "@/lib/marketing-next-call";
import type { MarketingTriggerType } from "@/lib/marketing-template-trigger-types";

export type MarketingTemplateParamSlot = "first_name" | "call_time";

export type MarketingTemplatePreset = {
  name: string;
  category: "MARKETING" | "UTILITY";
  body: string;
};

export const MARKETING_TEMPLATE_PARAM_SLOTS: Record<
  MarketingTriggerType | "broadcast",
  MarketingTemplateParamSlot[]
> = {
  node_answered: ["first_name"],
  flow_completed: ["first_name"],
  call_day: ["first_name", "call_time"],
  broadcast: ["first_name"],
};

export const MARKETING_TEMPLATE_PRESETS: Record<MarketingTriggerType, MarketingTemplatePreset> = {
  node_answered: {
    name: "call_booked",
    category: "UTILITY",
    body: "היי {{1}}, קבענו שיחה — נשלח תזכורת ביום הפגישה 😊",
  },
  flow_completed: {
    name: "flow_done",
    category: "MARKETING",
    body: "היי {{1}}, תודה שהשלמת את השיחה איתי! אם יש שאלה נוספת אני כאן.",
  },
  call_day: {
    name: "call_today",
    category: "UTILITY",
    body: "היי {{1}}, יש לנו שיחה היום בשעה {{2}} 📅 נשמח לדבר!",
  },
};

export function marketingPresetVarHint(triggerType: MarketingTriggerType | "broadcast"): string {
  const slots = MARKETING_TEMPLATE_PARAM_SLOTS[triggerType];
  const labels: Record<MarketingTemplateParamSlot, string> = {
    first_name: "שם פרטי",
    call_time: "שעת השיחה",
  };
  return slots.map((slot, i) => `{{${i + 1}}} = ${labels[slot]}`).join(" · ");
}

export function marketingPresetExampleForSlot(slot: MarketingTemplateParamSlot): string {
  if (slot === "call_time") return "14:00";
  return "דנה";
}

/** Meta body param when no HH:mm is stored yet — reads as «בשעה בקרוב». */
export const MARKETING_CALL_TIME_FALLBACK = "בקרוב";

/** Prefer a later-saved HH:mm over a queued «בקרוב» placeholder. */
export function preferLiveCallTime(
  queued: string | null | undefined,
  live: string | null | undefined
): string {
  return toPipelineTime(live) ?? toPipelineTime(queued) ?? MARKETING_CALL_TIME_FALLBACK;
}

export function mergeMarketingCallDayBodyParams(queued: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return queued.slice();
  if (queued.length === 0) return incoming.slice();
  const out = incoming.slice();
  if (!String(out[0] ?? "").trim() && queued[0]) out[0] = queued[0];
  while (out.length < Math.max(2, queued.length)) {
    out.push(queued[out.length] ?? "");
  }
  out[1] = preferLiveCallTime(queued[1], incoming[1]);
  return out;
}

export function resolveMarketingTemplateBodyParams(input: {
  triggerType: MarketingTriggerType | "broadcast";
  varCount: number;
  firstName: string;
  callTime?: string | null;
}): string[] {
  const count = Math.max(0, Math.trunc(input.varCount) || 0);
  if (count <= 0) return [];
  const slots = MARKETING_TEMPLATE_PARAM_SLOTS[input.triggerType];
  const first = String(input.firstName ?? "").trim() || "שלום";
  const callTime = preferLiveCallTime(null, input.callTime);
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const slot = slots[i] ?? (i === 1 ? "call_time" : "first_name");
    values.push(slot === "call_time" ? callTime : first);
  }
  return values;
}
