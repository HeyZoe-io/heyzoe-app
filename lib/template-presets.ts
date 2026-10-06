import { isMarketingOptOutButtonText } from "@/lib/meta-marketing-opt-out-button";
import { isTriggerAlertMuteButtonText } from "@/lib/meta-trigger-alert-mute-button";
import { isArboxDependentTriggerType, type TriggerType } from "@/lib/template-trigger-types";

export type TemplatePresetCategory = "MARKETING" | "UTILITY";

export type TemplateParamSlot =
  | "first_name"
  | "business_name"
  | "expiry_date"
  | "start_date"
  | "membership_type_name"
  | "class_name"
  | "class_time"
  | "class_date"
  | "workout_n"
  | "client_full_name"
  | "client_general_notes";

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
  first_paid_purchase: ["first_name", "business_name"],
  credit_refusal: ["first_name"],
  birthday: ["first_name", "business_name"],
  birthday_former: ["first_name", "business_name"],
  membership_expiring: ["first_name", "business_name", "expiry_date"],
  sessions_expiring: ["first_name", "business_name", "expiry_date"],
  registered_after_trial: ["first_name", "class_name"],
  not_registered_after_trial: ["first_name", "class_name"],
  membership_cancelled: ["membership_type_name", "expiry_date"],
  missed_class: ["first_name", "class_name"],
  missed_trial: ["first_name", "class_name"],
  attendance_gap: ["first_name", "business_name"],
  freeze_created: ["first_name", "start_date", "expiry_date"],
  freeze_ending_unbooked: ["first_name", "expiry_date"],
  freeze_ending_booked: ["first_name", "class_name", "expiry_date"],
  lost_lead: ["first_name"],
  trial_reminder: ["first_name", "class_name", "class_time"],
  trial_booked: ["first_name", "class_name", "class_date", "class_time"],
  milestones: ["first_name"],
  nth_workout: ["first_name", "workout_n"],
  trainer_trial_heads_up: ["class_name", "class_time", "client_full_name", "client_general_notes"],
  class_cancelled_staff: ["class_name", "class_date", "class_time"],
  class_cancelled_customer: ["first_name", "class_name", "class_date", "class_time"],
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
  first_paid_purchase: {
    name: "first_paid_purchase",
    category: "UTILITY",
    body: "היי {{1}}, איזה כיף שהצטרפת ל{{2}}! מחכים לך באימון הראשון.",
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
  birthday_former: {
    name: "birthday_former_wish",
    category: "MARKETING",
    body: "יום הולדת שמח {{1}}! 🎂 מתגעגעים אלייך ב{{2}} — נשמח לראותך שוב לאימון 😊",
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
  registered_after_trial: {
    name: "registered_after_trial",
    category: "UTILITY",
    body: "היי {{1}}, שמחנו לראות שנרשמת להמשך אחרי שיעור הניסיון ({{2}}).",
  },
  not_registered_after_trial: {
    name: "not_registered_after_trial",
    category: "MARKETING",
    body: "היי {{1}}, איך היה בשיעור הניסיון ({{2}})? מתי נוח שניצור איתך קשר לגבי הצטרפות?",
    button_text: "אשמח שיחזרו אליי",
  },
  membership_cancelled: {
    name: "membership_cancelled",
    category: "UTILITY",
    body: "ביטול המנוי {{1}} עודכן במערכת בהצלחה✔️ תוקף המנוי הינו עד תאריך {{2}}. אין צורך בפעולה נוספת.",
  },
  missed_class: {
    name: "missed_class",
    category: "UTILITY",
    body: "היי {{1}}, ראינו שנרשמת ל{{2}} ולא הגעת, הכל בסדר?",
  },
  missed_trial: {
    name: "missed_trial",
    category: "MARKETING",
    body: "היי {{1}}, ראינו שנרשמת לשיעור ניסיון ({{2}}) ולא הגעת. מה קרה? מתי נוח לקבוע מחדש?",
  },
  attendance_gap: {
    name: "attendance_gap",
    category: "MARKETING",
    body: "היי {{1}}, כבר לא ראינו אותך ב{{2}} זמן מה. בא לך שנמצא יחד שיעור שמתאים לך לחזור?",
    button_text: "אשמח לחזור",
  },
  freeze_created: {
    name: "freeze_created",
    category: "UTILITY",
    body: "היי {{1}}, ההקפאה שלך נרשמה ל-{{2}} עד {{3}}. אין צורך בפעולה נוספת.",
  },
  freeze_ending_unbooked: {
    name: "freeze_ending_unbooked",
    category: "UTILITY",
    body: "היי {{1}}, ההקפאה שלך מסתיימת ב-{{2}}. אפשר כבר לקבוע שיעור להמשך.",
  },
  freeze_ending_booked: {
    name: "freeze_ending_booked",
    category: "UTILITY",
    body: "היי {{1}}, ההקפאה שלך מסתיימת ב-{{3}} — שמחנו לראות שנרשמת ל{{2}}. נתראה!",
  },
  lost_lead: {
    name: "lost_lead",
    category: "MARKETING",
    body: "היי {{1}}, יש הרבה החלטות שאנחנו נאלצים לקבל ביום-יום, אבל יש כאלה שיכולות לשדרג את החיים שלנו משמעותית 💪 בא לנו לפרגן לך באימון ניסיון במחיר הנחה - רק דרך השיחה הזו. לוחצים על הכפתור ומתחילים!",
    button_text: "אשמח לפרטים",
  },
  trial_reminder: {
    name: "trial_reminder",
    category: "UTILITY",
    body: "היי {{1}}, רציתי לוודא הגעה לאימון הניסיון {{2}} בשעה {{3}}. נשמח לראותך!",
  },
  trial_booked: {
    name: "trial_booked",
    category: "UTILITY",
    body: "היי {{1}}, קיבלנו את ההרשמה שלך לאימון הניסיון {{2}} בתאריך {{3}} בשעה {{4}}. מחכים לראותך בסטודיו.",
  },
  milestones: {
    name: "milestones",
    category: "MARKETING",
    body: "היי {{1}}, היחס האישי ורמת האימון חשובים לנו, נשמח לשמוע איך הולך.",
  },
  nth_workout: {
    name: "nth_workout",
    category: "MARKETING",
    body: "היי {{1}}, ראינו שהיית לאחרונה, זה כבר האימון ה-{{2}} שלך אצלנו, נשמח לפידבק ולהגדיר מטרות.",
  },
  trainer_trial_heads_up: {
    name: "trainer_trial_heads_up",
    category: "UTILITY",
    body: "היי! היום מגיע אליך לאימון {{1}} בשעה {{2}}. שם הלקוח: {{3}}. בבקשה לשים לב להערות הכלליות: {{4}}. תודה.",
  },
  class_cancelled_staff: {
    name: "class_cancelled_staff",
    category: "UTILITY",
    body: "שים לב - השיעור {{1}} בתאריך {{2}} בשעה {{3}} בוטל.",
  },
  class_cancelled_customer: {
    name: "class_cancelled_customer",
    category: "UTILITY",
    body: "היי {{1}}, השיעור {{2}} שנרשמת אליו בתאריך {{3}} בשעה {{4}} בוטל. אם תרצו לקבוע מועד אחר נשמח לעזור.",
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

/** Marks an RTL editor can drop inside `{{1}}`, which makes Meta ignore the placeholder. */
const TEMPLATE_BIDI_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff\u200b-\u200d\u2060]/g;

/**
 * Strips bidi marks and tightens `{{ 1 }}` to `{{1}}`.
 * Meta treats a spaced or marked placeholder as a different parameter, then
 * rejects the positional `example` with subcode 2388043.
 */
export function normalizeTemplatePlaceholderText(text: string): string {
  return String(text ?? "")
    .replace(TEMPLATE_BIDI_RE, "")
    .replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, n: string) => `{{${Number(n)}}}`);
}

/** Distinct positional indexes in ascending order, after placeholder normalization. */
export function positionalPlaceholderIndexes(text: string): number[] {
  const found = new Set<number>();
  for (const m of normalizeTemplatePlaceholderText(text).matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

function placeholdersAreContiguous(indexes: number[]): boolean {
  return indexes.length > 0 && indexes.every((n, i) => n === i + 1);
}

/**
 * Meta 2388043: example length must equal the variables, and indexes must be
 * {{1}}..{{n}} with no gaps. `{{2}}` alone, or `{{1}}` plus `{{3}}`, fails.
 */
export function templateVariableSequenceMessage(
  text: string,
  part: "body" | "header" = "body"
): string | null {
  const indexes = positionalPlaceholderIndexes(text);
  if (!indexes.length) return null;
  if (part === "header" && indexes.length > 1) {
    return "בכותרת אפשר משתנה אחד בלבד, {{1}}.";
  }
  if (placeholdersAreContiguous(indexes)) return null;
  const where = part === "header" ? "בכותרת" : "בגוף ההודעה";
  return `המשתנים ${where} צריכים להתחיל ב־{{1}} ולהמשיך ברצף, בלי לדלג על מספר.`;
}

function namedPlaceholderMessage(text: string, part: "body" | "header"): string | null {
  const withoutPositional = normalizeTemplatePlaceholderText(text).replace(/\{\{\d+\}\}/g, "");
  if (!/\{\{[^{}]+\}\}/.test(withoutPositional)) return null;
  const where = part === "header" ? "בכותרת" : "בגוף ההודעה";
  return `משתנה ${where} נכתב כ־{{1}} או {{2}}. אי אפשר לכתוב שם בתוך הסוגריים.`;
}

function fallbackTemplateExample(index: number): string {
  return index === 0 ? "דנה" : `ערך${index + 1}`;
}

function paddedTemplateExamples(existing: string[], count: number): string[] {
  return Array.from({ length: count }, (_, i) => existing[i]?.trim() || fallbackTemplateExample(i));
}

function headerExampleValues(c: Record<string, unknown>): string[] {
  const example = c.example;
  if (!example || typeof example !== "object") return [];
  const headerText = (example as { header_text?: unknown }).header_text;
  if (!Array.isArray(headerText)) return [];
  return headerText.map((v) => String(v ?? ""));
}

/**
 * Normalizes placeholder text and rebuilds BODY/HEADER examples so the sample
 * count matches {{1}}..{{n}}. Drops a positional example when the text has no
 * positional variables — Meta reports that mismatch as a missing example.
 */
export function withNormalizedTemplateComponents(components: unknown[]): unknown[] {
  if (!Array.isArray(components)) return [];
  return components.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const c = { ...(raw as Record<string, unknown>) };
    const type = String(c.type ?? "").toUpperCase();
    if (
      (type === "BODY" || type === "HEADER" || type === "FOOTER") &&
      typeof c.text === "string"
    ) {
      c.text = normalizeTemplatePlaceholderText(c.text);
    }
    if (type === "HEADER" && typeof c.text === "string") {
      const format = String(c.format ?? "TEXT").toUpperCase();
      if (format === "TEXT") {
        const indexes = positionalPlaceholderIndexes(c.text);
        if (placeholdersAreContiguous(indexes) && indexes.length === 1) {
          c.example = { header_text: paddedTemplateExamples(headerExampleValues(c), 1) };
        } else if (indexes.length === 0) {
          delete c.example;
        }
      }
    }
    if (type === "BODY" && typeof c.text === "string") {
      const indexes = positionalPlaceholderIndexes(c.text);
      if (placeholdersAreContiguous(indexes)) {
        c.example = {
          body_text: [paddedTemplateExamples(exampleValuesFromBodyComponent(c), indexes.length)],
        };
      } else if (indexes.length === 0) {
        delete c.example;
      }
    }
    if (type === "BUTTONS" && Array.isArray(c.buttons)) {
      c.buttons = c.buttons.map((button) => {
        if (!button || typeof button !== "object") return button;
        const b = { ...(button as Record<string, unknown>) };
        if (typeof b.text === "string") b.text = normalizeTemplatePlaceholderText(b.text);
        if (typeof b.url === "string") b.url = normalizeTemplatePlaceholderText(b.url);
        return b;
      });
    }
    return c;
  });
}

/**
 * Meta 2388299: a variable at the start, or at the end when only a period follows.
 * A closing character such as ")" before the period is accepted; a bare "{{2}}." is not.
 */
export function templateTextEdgeVariableMessage(
  text: string,
  part: "body" | "header" = "body"
): string | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const matches = [...trimmed.matchAll(/\{\{\s*\d+\s*\}\}/g)];
  if (!matches.length) return null;
  const where = part === "header" ? "הכותרת" : "גוף ההודעה";
  const first = matches[0];
  if (!trimmed.slice(0, first.index ?? 0).trim()) {
    return `${where} מתחיל במשתנה. הוסיפו מילה לפניו.`;
  }
  const last = matches[matches.length - 1];
  const after = trimmed.slice((last.index ?? 0) + last[0].length);
  if (/^[\s.。]*$/u.test(after)) {
    return `${where} נגמר במשתנה. הוסיפו מילה או משפט אחרי המשתנה האחרון.`;
  }
  return null;
}

export function templateComponentsEdgeVariableMessage(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { type?: unknown; text?: unknown; format?: unknown };
    const type = String(c.type ?? "").toUpperCase();
    if (type !== "BODY" && type !== "HEADER") continue;
    if (type === "HEADER" && String(c.format ?? "TEXT").toUpperCase() !== "TEXT") continue;
    const message = templateTextEdgeVariableMessage(String(c.text ?? ""), type === "HEADER" ? "header" : "body");
    if (message) return message;
  }
  return null;
}

/** Whitespace tokens Meta counts: a word of 2+ letters, or a standalone dash. */
function countMetaStaticWords(text: string): number {
  const cleaned = String(text ?? "").replace(/\{\{\s*\d+\s*\}\}/g, " ");
  let count = 0;
  for (const token of cleaned.split(/\s+/)) {
    if (!token) continue;
    const letters = token.match(/[\u0590-\u05FFa-zA-Z]/g);
    if (letters && letters.length >= 2) {
      count += 1;
      continue;
    }
    if (/^[-–—]+$/u.test(token)) count += 1;
  }
  return count;
}

/**
 * Meta 2388293. Empirically: static words + variables >= 3×variables + 1.
 * A one-letter token such as "ב-" does not count; a spaced hyphen does.
 */
export function templateTextVariableDensityMessage(text: string): string | null {
  const params = [...String(text ?? "").matchAll(/\{\{\s*\d+\s*\}\}/g)].length;
  if (!params) return null;
  const words = countMetaStaticWords(text);
  if (words + params < params * 3 + 1) {
    return "יש יותר מדי משתנים ביחס לאורך הטקסט. הוסיפו משפט קבוע בלי משתנה נוסף.";
  }
  return null;
}

export function templateTextMetaPolicyMessage(
  text: string,
  part: "body" | "header" = "body"
): string | null {
  const normalized = normalizeTemplatePlaceholderText(text);
  const edge = templateTextEdgeVariableMessage(normalized, part);
  if (edge) return edge;
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(normalized)) {
    const where = part === "header" ? "בכותרת" : "בגוף ההודעה";
    return `שני משתנים צמודים ${where}. שימו מילה ביניהם.`;
  }
  const named = namedPlaceholderMessage(normalized, part);
  if (named) return named;
  const sequence = templateVariableSequenceMessage(normalized, part);
  if (sequence) return sequence;
  if (part === "body") return templateTextVariableDensityMessage(normalized);
  return null;
}

export function templateComponentsMetaPolicyMessage(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { type?: unknown; text?: unknown; format?: unknown };
    const type = String(c.type ?? "").toUpperCase();
    if (type !== "BODY" && type !== "HEADER") continue;
    if (type === "HEADER" && String(c.format ?? "TEXT").toUpperCase() !== "TEXT") continue;
    const message = templateTextMetaPolicyMessage(
      String(c.text ?? ""),
      type === "HEADER" ? "header" : "body"
    );
    if (message) return message;
  }
  return null;
}

/** Maps Meta template-create errors the dashboard can show without the raw Graph payload. */
export function hebrewMetaTemplateApiError(detail: string): string | null {
  const text = String(detail ?? "");
  if (text.includes("2388299") || /Leading or Trailing Params/i.test(text)) {
    return "מטא דחתה את הטמפלייט כי הוא מתחיל או נגמר במשתנה. הוסיפו מילה או משפט אחרי המשתנה האחרון.";
  }
  if (text.includes("2388293") || /Params Words Ratio/i.test(text)) {
    return "מטא דחתה את הטמפלייט כי יש יותר מדי משתנים ביחס לאורך הטקסט. הוסיפו משפט קבוע בלי משתנה נוסף.";
  }
  if (text.includes("2388037")) {
    return "מטא דחתה את הטמפלייט כי המשתנים חייבים להתחיל ב־{{1}}.";
  }
  if (text.includes("2388043") || /missing expected field\(s\) \(example\)/i.test(text)) {
    return "מטא דחתה את הטמפלייט כי חסרה דוגמה תואמת לכל משתנה. השתמשו ב־{{1}}, {{2}} ברצף, בלי לדלג על מספר.";
  }
  if (text.includes("80008") || /too many calls/i.test(text)) {
    return "מטא חסמה זמנית את חשבון הוואטסאפ כי היו יותר מדי קריאות. חכי כמה דקות ונסי שוב. הטקסט עצמו לא נדחה.";
  }
  return null;
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
      const editable = list.filter((bRaw) => {
        if (!bRaw || typeof bRaw !== "object") return false;
        const text = String((bRaw as { text?: unknown }).text ?? "");
        return !isMarketingOptOutButtonText(text) && !isTriggerAlertMuteButtonText(text);
      });
      if (editable.length > DASHBOARD_MAX_BUTTONS) return null;
      for (const bRaw of list) {
        if (!bRaw || typeof bRaw !== "object") continue;
        const b = bRaw as Record<string, unknown>;
        const bType = String(b.type ?? "").toUpperCase();
        const label = String(b.text ?? "");
        if (isMarketingOptOutButtonText(label) || isTriggerAlertMuteButtonText(label)) continue;
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
  if (slot === "class_name") return "יוגה";
  if (slot === "class_time") return "18:00";
  if (slot === "client_full_name") return "דנה כהן";
  if (slot === "client_general_notes") return "פציעה בברך, להתחיל לאט";
  if (slot === "workout_n") return "3";
  return "01.09.2026";
}

export function presetVarHint(triggerType: TriggerType): string {
  const slots = TEMPLATE_PARAM_SLOTS[triggerType];
  const labels: Record<TemplateParamSlot, string> = {
    first_name: "שם פרטי",
    business_name: "שם העסק",
    expiry_date: "תאריך פקיעה",
    start_date: "תאריך התחלה",
    membership_type_name: "סוג מנוי",
    class_name: "שם השיעור",
    class_time: "שעת השיעור",
    class_date: "תאריך השיעור",
    workout_n: "מספר האימון",
    client_full_name: "שם מלא לקוח",
    client_general_notes: "הערות כלליות מארבוקס",
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
