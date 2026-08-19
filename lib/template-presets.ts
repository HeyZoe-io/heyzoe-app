import { isArboxDependentTriggerType, type TriggerType } from "@/lib/template-trigger-types";

export type TemplatePresetCategory = "MARKETING" | "UTILITY";

export type TemplateParamSlot = "first_name" | "business_name" | "expiry_date";

export type TemplatePreset = {
  name: string;
  category: TemplatePresetCategory;
  body: string;
  button_text?: string;
};

/** Positional Meta body slots for each trigger_type ({{1}}, {{2}}, {{3}}). */
export const TEMPLATE_PARAM_SLOTS: Record<TriggerType, TemplateParamSlot[]> = {
  incoming_lead: ["business_name"],
  arbox_new_lead: ["business_name"],
  no_response: ["first_name"],
  purchase: ["first_name", "business_name"],
  credit_refusal: ["first_name"],
  birthday: ["first_name", "business_name"],
  membership_expiring: ["first_name", "business_name", "expiry_date"],
  sessions_expiring: ["first_name", "business_name", "expiry_date"],
  trial_attended: ["first_name"],
};

const LEAD_OPENING_BODY =
  "תודה שהתעניינתם ב{{1}}! בואו נכיר :) לחצו על הכפתור 👇";

export const TEMPLATE_PRESETS: Record<TriggerType, TemplatePreset> = {
  incoming_lead: {
    name: "incoming_lead",
    category: "MARKETING",
    body: LEAD_OPENING_BODY,
    button_text: "בואו נתחיל",
  },
  arbox_new_lead: {
    name: "arbox_new_lead",
    category: "MARKETING",
    body: LEAD_OPENING_BODY,
    button_text: "בואו נתחיל",
  },
  no_response: {
    name: "no_response",
    category: "MARKETING",
    body: "היי {{1}}! דיברנו בעבר וחבל שיתפספס לנו 😊 מה דעתך להגיע לאימון ניסיון הקרוב ופשוט לנסות, בלי התחייבות?",
    button_text: "אשמח לפרטים",
  },
  purchase: {
    name: "purchase_thanks",
    category: "UTILITY",
    body: "היי {{1}}, תודה על הרכישה! איזה כיף שאתם עכשיו חלק מ{{2}}! 🎉",
  },
  credit_refusal: {
    name: "credit_refusal",
    category: "UTILITY",
    body: "היי {{1}}, זיהינו בעיה בחיוב אמצעי התשלום. נשמח שתעדכן/י פרטים בהקדם כדי לשמור על המנוי שלך פעיל.",
  },
  birthday: {
    name: "birthday_wish",
    category: "MARKETING",
    body: "יום הולדת שמח {{1}}! 🎂 כל הצוות ב{{2}} מאחל לך שנה מדהימה, של אושר, נחת, והכי חשוב - גוף חזק ונפש רגועה!",
  },
  membership_expiring: {
    name: "membership_expiring",
    category: "MARKETING",
    body: "היי {{1}}, המנוי שלך ב{{2}} עומד לפוג ב-{{3}}. רוצה לחדש? אם כן יש לכתוב לי ״אשמח לחדש מנוי״ ונעביר את הפניה לצוות המטפל.",
    button_text: "חידוש מנוי",
  },
  sessions_expiring: {
    name: "sessions_expiring",
    category: "MARKETING",
    body: "היי {{1}}, הכרטיסייה שלך ב{{2}} עומדת לפוג ב-{{3}}. רוצה לחדש? אם כן יש לכתוב לי ״אשמח לחדש כרטיסיה״ ונעביר את הפניה לצוות המטפל.",
    button_text: "חידוש כרטיסיה",
  },
  trial_attended: {
    name: "trial_attended",
    category: "MARKETING",
    body: "היי {{1}}, איך היה בשיעור הניסיון? נשמח לעזור לך להמשיך 😊",
    button_text: "הצטרפות למנוי",
  },
};

export function extractBodyVarCount(body: string): number {
  let max = 0;
  for (const m of String(body ?? "").matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

export function bodyTextFromTemplateComponents(components: unknown): string {
  if (!Array.isArray(components)) return "";
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { type?: unknown; text?: unknown };
    if (String(c.type ?? "").toUpperCase() !== "BODY") continue;
    const text = String(c.text ?? "");
    if (text.trim()) return text;
  }
  return "";
}

export function paramSlotsForTriggerType(triggerType: string): TemplateParamSlot[] {
  const key = triggerType as TriggerType;
  if (key in TEMPLATE_PARAM_SLOTS) return TEMPLATE_PARAM_SLOTS[key];
  if (triggerType === "site_lead" || triggerType === "campaign_lead") {
    return TEMPLATE_PARAM_SLOTS.incoming_lead;
  }
  return ["first_name"];
}

export function presetExampleForSlot(slot: TemplateParamSlot): string {
  if (slot === "first_name") return "דנה";
  if (slot === "business_name") return "הסטודיו";
  return "01.09.2026";
}

export function presetVarHint(triggerType: TriggerType): string {
  const slots = TEMPLATE_PARAM_SLOTS[triggerType];
  const labels: Record<TemplateParamSlot, string> = {
    first_name: "שם פרטי",
    business_name: "שם העסק",
    expiry_date: "תאריך פקיעה",
  };
  return slots
    .map((slot, i) => `{{${i + 1}}} = ${labels[slot]}`)
    .join(" · ");
}

export function isPresetAvailable(triggerType: TriggerType, hasArbox: boolean): boolean {
  if (isArboxDependentTriggerType(triggerType) && !hasArbox) return false;
  return true;
}
