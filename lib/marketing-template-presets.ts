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
  const callTime = String(input.callTime ?? "").trim() || "בקרוב";
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const slot = slots[i] ?? (i === 1 ? "call_time" : "first_name");
    values.push(slot === "call_time" ? callTime : first);
  }
  return values;
}
