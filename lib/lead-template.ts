import type { ContactStatusInput } from "@/lib/contact-status";
import { SALES_FLOW_START_BUTTON_LABEL_HE } from "@/lib/sales-flow-start-triggers";

/** model_used ב-messages לשליחת טמפלייט פתיחה ממודעת Meta */
export const LEAD_TEMPLATE_MODEL = "lead_template";

/** 6 שעות אחרי טמפלייט פתיחה בלי תגובת ליד → ללא מענה + CRM */
export const TEMPLATE_NO_RESPONSE_AFTER_MS = 6 * 60 * 60 * 1000;

export function templateNoResponseDueAtIso(fromMs: number = Date.now()): string {
  return new Date(fromMs + TEMPLATE_NO_RESPONSE_AFTER_MS).toISOString();
}

/** איפוס מצב ליד ל«טמפלייט» כששולחים טמפלייט פתיחה מחדש (כולל לידים שסומנו לא רלוונטי). */
export function buildTemplateIncomingContactPatch(nowIso: string): Record<string, unknown> {
  return {
    source: "meta_lead_ad",
    session_phase: "opening",
    flow_step: 0,
    not_relevant_at: null,
    not_relevant_reason: "",
    human_requested_at: null,
    wa_followup_stage: 0,
    wa_no_response_at: null,
    wa_next_followup_at: null,
    wa_no_response_due_at: templateNoResponseDueAtIso(Date.parse(nowIso)),
    followup_sent: false,
    updated_at: nowIso,
  };
}

const LEAD_TEMPLATE_PLACEHOLDER_RE = /^נשלח טמפלייט פתיחה \(([^)]+)\)$/;

type LeadTemplatePreview = {
  header?: string;
  body: string;
  buttons?: string[];
  footer?: string;
};

/** תצוגה בדשבורד — טקסט הטמפלייט כפי שנשלח ב-Meta (לא שליפה בזמן אמת). */
const LEAD_TEMPLATE_REGISTRY: Record<string, LeadTemplatePreview> = {
  sangha_lead_welcome: {
    header: "סאנגה יוגה",
    body: "היי {{1}}! איזה כיף להכיר.\nלחצ/י על הכפתור ואספר לך הכל על סאנגה יוגה🧘",
    buttons: [SALES_FLOW_START_BUTTON_LABEL_HE],
    footer: "Hey Zoe",
  },
  sanga_welcome2: {
    body: [
      "היי! כאן זואי מסאנגה יוגה 🧘",
      "לחצ/י על הכפתור לקבלת פרטים,",
      "וגם אעזור לך למצוא את השיעור המדויק לך👇",
    ].join("\n"),
  },
  sanga_quiz_welcome: {
    body: [
      "מתלבטים אם להתחיל לתרגל איתנו יוגה?",
      "הרכבנו 5 שאלות קצרות כדי שנבין יחד האם זה בשבילך!",
      "בדרך נגלה כמה דברים שאולי לא ידעת על יוגה. מתחילים?",
    ].join("\n"),
    buttons: ["בואו נתחיל!"],
  },
};

/** האם לשלוח {{1}} = שם פרטי ב-body של הטמפלייט ב-Meta. */
export function leadTemplateUsesFirstName(templateName: string): boolean {
  const key = String(templateName ?? "").trim();
  if (!key) return true;
  const preview = LEAD_TEMPLATE_REGISTRY[key];
  if (!preview) return true;
  return preview.body.includes("{{1}}");
}

export function firstNameFromFullName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "שלום";
  return trimmed.split(/\s+/).filter(Boolean)[0] ?? trimmed;
}

export function renderLeadTemplateMessageContent(
  templateName: string,
  opts?: { firstName?: string }
): string {
  const key = String(templateName ?? "").trim() || "lead_welcome";
  const preview = LEAD_TEMPLATE_REGISTRY[key];
  if (!preview) {
    return `נשלח טמפלייט פתיחה (${key})`;
  }

  const firstName = String(opts?.firstName ?? "").trim() || "שלום";
  const lines: string[] = [];
  if (preview.header?.trim()) lines.push(preview.header.trim());
  lines.push(preview.body.replace(/\{\{1\}\}/g, firstName));
  if (preview.footer?.trim()) lines.push(preview.footer.trim());

  let text = lines.join("\n\n");
  for (const btn of preview.buttons ?? []) {
    const label = String(btn ?? "").trim();
    if (label) text += `\n\n[כפתור: ${label}]`;
  }
  return text;
}

/** @deprecated Use renderLeadTemplateMessageContent — kept for call sites. */
export function formatLeadTemplateMessageContent(
  templateName: string,
  opts?: { firstName?: string }
): string {
  return renderLeadTemplateMessageContent(templateName, opts);
}

/** האם ההודעה היא placeholder «נשלח טמפלייט…» שדורש העשרה לתצוגה. */
export function leadTemplatePlaceholderNeedsEnrichment(content: string): boolean {
  return LEAD_TEMPLATE_PLACEHOLDER_RE.test(String(content ?? "").trim());
}

/** משדרג רשומות ישנות «נשלח טמפלייט…» לטקסט מלא לתצוגה בדשבורד. */
export function resolveLeadTemplateDisplayContent(
  content: string,
  opts?: { firstName?: string }
): string {
  const raw = String(content ?? "").trim();
  const m = raw.match(LEAD_TEMPLATE_PLACEHOLDER_RE);
  if (!m) return raw;
  return renderLeadTemplateMessageContent(m[1]!, opts);
}

/** ליד שקיבל טמפלייט ועדיין לא התחיל שיחה (לא ענה / לא התקדם בפלואו). */
export function isLeadTemplateOnlyContact(input: ContactStatusInput): boolean {
  if (String(input.source ?? "").trim() !== "meta_lead_ad") return false;
  if (input.opted_out === true) return false;
  if (input.not_relevant_at) return false;
  if (input.human_requested_at) return false;
  if (input.trial_registered === true || input.session_phase === "registered") return false;

  const stage = Number(input.wa_followup_stage ?? 0);
  if (stage > 0) return false;

  return String(input.session_phase ?? "").trim() === "opening";
}
