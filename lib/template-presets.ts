import { isArboxDependentTriggerType, type TriggerType } from "@/lib/template-trigger-types";

export type TemplatePresetCategory = "MARKETING" | "UTILITY";

export type TemplateParamSlot =
  | "first_name"
  | "business_name"
  | "expiry_date"
  | "membership_type_name";

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
  membership_cancelled: ["membership_type_name", "expiry_date"],
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
    body: "היי {{1}}, איך היה בשיעור הניסיון? נשמח לעזור לך להמשיך 😊\nיש לנו מספר אפשרויות להצטרפות למנוי:",
    button_text: "הצטרפות למנוי",
  },
  membership_cancelled: {
    name: "membership_cancelled",
    category: "UTILITY",
    body: "ביטול המנוי {{1}} עודכן במערכת בהצלחה✔️ תוקף המנוי הינו עד תאריך {{2}}.",
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

export type DashboardTemplateButton = {
  kind: "QUICK_REPLY" | "URL";
  text: string;
  url: string;
};

export type DashboardTemplateDraft = {
  body: string;
  header: string;
  footer: string;
  buttons: DashboardTemplateButton[];
  exampleValues: string[];
};

const DASHBOARD_BUTTON_TYPES = new Set(["QUICK_REPLY", "URL"]);
const DASHBOARD_MAX_BUTTONS = 2;

function exampleValuesFromBodyComponent(c: Record<string, unknown>): string[] {
  const example = c.example;
  if (!example || typeof example !== "object") return [];
  const bodyText = (example as { body_text?: unknown }).body_text;
  if (!Array.isArray(bodyText) || !Array.isArray(bodyText[0])) return [];
  return bodyText[0].map((v) => String(v ?? ""));
}

/**
 * Parses Meta `components` into the dashboard create/edit form.
 * Returns null when the template has pieces the form cannot round-trip
 * (image header, phone/flow buttons, carousel, more than 2 buttons, …).
 */
export function parseDashboardTemplateComponents(
  components: unknown
): DashboardTemplateDraft | null {
  if (!Array.isArray(components)) {
    return {
      body: "",
      header: "",
      footer: "",
      buttons: [{ kind: "QUICK_REPLY", text: "", url: "" }],
      exampleValues: [],
    };
  }

  let body = "";
  let header = "";
  let footer = "";
  let exampleValues: string[] = [];
  const buttons: DashboardTemplateButton[] = [];

  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const type = String(c.type ?? "").toUpperCase();
    if (!type) continue;

    if (type === "BODY") {
      body = String(c.text ?? "");
      exampleValues = exampleValuesFromBodyComponent(c);
      continue;
    }
    if (type === "HEADER") {
      const format = String(c.format ?? (c.text != null ? "TEXT" : "")).toUpperCase();
      if (format && format !== "TEXT") return null;
      header = String(c.text ?? "");
      continue;
    }
    if (type === "FOOTER") {
      footer = String(c.text ?? "");
      continue;
    }
    if (type === "BUTTONS") {
      const list = Array.isArray(c.buttons) ? c.buttons : [];
      if (list.length > DASHBOARD_MAX_BUTTONS) return null;
      for (const bRaw of list) {
        if (!bRaw || typeof bRaw !== "object") continue;
        const b = bRaw as Record<string, unknown>;
        const bType = String(b.type ?? "").toUpperCase();
        if (!DASHBOARD_BUTTON_TYPES.has(bType)) return null;
        buttons.push({
          kind: bType === "URL" ? "URL" : "QUICK_REPLY",
          text: String(b.text ?? ""),
          url: String(b.url ?? ""),
        });
      }
      continue;
    }
    return null;
  }

  return {
    body,
    header,
    footer,
    buttons: buttons.length > 0 ? buttons : [{ kind: "QUICK_REPLY", text: "", url: "" }],
    exampleValues,
  };
}

const META_EDITABLE_STATUSES = new Set(["APPROVED", "REJECTED", "PAUSED", "DISABLED"]);

/** Meta only accepts content edits for these statuses (not PENDING / deleted). */
export function isMetaTemplateContentEditable(status: string): boolean {
  return META_EDITABLE_STATUSES.has(String(status ?? "").trim().toUpperCase());
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
  if (slot === "membership_type_name") return "מנוי חודשי";
  return "01.09.2026";
}

export function presetVarHint(triggerType: TriggerType): string {
  const slots = TEMPLATE_PARAM_SLOTS[triggerType];
  const labels: Record<TemplateParamSlot, string> = {
    first_name: "שם פרטי",
    business_name: "שם העסק",
    expiry_date: "תאריך פקיעה",
    membership_type_name: "סוג מנוי",
  };
  return slots
    .map((slot, i) => `{{${i + 1}}} = ${labels[slot]}`)
    .join(" · ");
}

export function isPresetAvailable(triggerType: TriggerType, hasArbox: boolean): boolean {
  if (isArboxDependentTriggerType(triggerType) && !hasArbox) return false;
  return true;
}

const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;
const UNIQUE_TEMPLATE_NAME_MAX = 999;

/**
 * Preset names are unique per WABA. If `incoming_lead` is taken, the next create
 * gets `incoming_lead1`, then `incoming_lead2`, and so on.
 */
export function uniqueTemplateName(
  baseName: string,
  existingNames: readonly string[]
): string {
  const base = String(baseName ?? "").trim().toLowerCase();
  if (!TEMPLATE_NAME_RE.test(base)) return base;
  const taken = new Set(
    existingNames.map((n) => String(n ?? "").trim().toLowerCase()).filter(Boolean)
  );
  if (!taken.has(base)) return base;
  for (let n = 1; n <= UNIQUE_TEMPLATE_NAME_MAX; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${Date.now()}`;
}
