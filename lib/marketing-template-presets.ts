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
    body: "היי {{1}}, מזכירה שיש לנו שיחה היום{{2}} 📅\nבמידה ויש בעיה כלשהי נשמח לעדכון. אחרת - מצפים לדבר איתך :)",
  },
};

/** Copy when {{2}} is omitted — Meta templates cannot drop the baked-in «בשעה». */
export const MARKETING_CALL_DAY_NO_TIME_FALLBACK_BODY =
  "היי {{1}}, מזכירה שיש לנו שיחה היום  📅 \nבמידה ויש בעיה כלשהי נשמח לעדכון. אחרת - מצפים לדבר איתך :)";

export function marketingPresetVarHint(triggerType: MarketingTriggerType | "broadcast"): string {
  const slots = MARKETING_TEMPLATE_PARAM_SLOTS[triggerType];
  const labels: Record<MarketingTemplateParamSlot, string> = {
    first_name: "שם פרטי",
    call_time: "שעת השיחה",
  };
  return slots.map((slot, i) => `{{${i + 1}}} = ${labels[slot]}`).join(" · ");
}

export function marketingPresetExampleForSlot(slot: MarketingTemplateParamSlot): string {
  if (slot === "call_time") return " בשעה 14:00";
  return "דנה";
}

/** Legacy queued param — treat as missing hour. */
export const MARKETING_CALL_TIME_FALLBACK = "בקרוב";

/** Non-empty Meta param when the template has no baked-in «בשעה {{n}}». */
export const MARKETING_CALL_TIME_OMIT = " ";

export function resolveCallTimeHm(
  queued: string | null | undefined,
  live?: string | null
): string | null {
  return toPipelineTime(live) ?? toPipelineTime(queued);
}

/** Prefer a later-saved HH:mm; empty string if none (never «בקרוב»). */
export function preferLiveCallTime(
  queued: string | null | undefined,
  live: string | null | undefined
): string {
  return resolveCallTimeHm(queued, live) ?? "";
}

export function callDayTemplateBakesInHour(bodyText: string): boolean {
  return /בשעה\s*\{\{\s*\d+\s*\}\}/u.test(bodyText);
}

export function formatMarketingCallTimeParam(
  callTime: string | null | undefined,
  bodyText = ""
): string {
  const hm = toPipelineTime(callTime);
  const shaahInBody = callDayTemplateBakesInHour(bodyText);
  if (hm) return shaahInBody ? hm : `בשעה ${hm}`;
  return shaahInBody ? "" : MARKETING_CALL_TIME_OMIT;
}

export function renderMarketingCallDayFallbackText(input: {
  body?: string | null;
  firstName: string;
}): string {
  const first = String(input.firstName ?? "").trim() || "שלום";
  const raw = String(input.body ?? "").trim() || MARKETING_CALL_DAY_NO_TIME_FALLBACK_BODY;
  return raw
    .replace(/\{\{\s*1\s*\}\}/g, first)
    .replace(/בשעה\s*\{\{\s*\d+\s*\}\}/gu, "")
    .replace(/\{\{\s*\d+\s*\}\}/g, "")
    .replace(/[^\S\n]+$/gm, "")
    .trim();
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
  bodyText?: string | null;
}): string[] {
  const count = Math.max(0, Math.trunc(input.varCount) || 0);
  if (count <= 0) return [];
  const slots = MARKETING_TEMPLATE_PARAM_SLOTS[input.triggerType];
  const first = String(input.firstName ?? "").trim() || "שלום";
  const callTime = formatMarketingCallTimeParam(input.callTime, String(input.bodyText ?? ""));
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const slot = slots[i] ?? (i === 1 ? "call_time" : "first_name");
    values.push(slot === "call_time" ? callTime : first);
  }
  return values;
}
