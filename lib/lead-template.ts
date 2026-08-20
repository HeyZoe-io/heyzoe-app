import type { ContactStatusInput } from "@/lib/contact-status";
import { SALES_FLOW_START_BUTTON_LABEL_HE } from "@/lib/sales-flow-start-triggers";
import { salesFlowOpeningResetPatch } from "@/lib/wa-warmup-awaiting-idx";

/** model_used ב-messages לשליחת טמפלייט פתיחה ממודעת Meta */
export const LEAD_TEMPLATE_MODEL = "lead_template";

/** 6 שעות אחרי טמפלייט פתיחה בלי תגובת ליד → ללא מענה + CRM */
export const TEMPLATE_NO_RESPONSE_AFTER_MS = 6 * 60 * 60 * 1000;

export function templateNoResponseDueAtIso(fromMs: number = Date.now()): string {
  return new Date(fromMs + TEMPLATE_NO_RESPONSE_AFTER_MS).toISOString();
}

/** Opening-template lead sources (Meta ads + site form webhook). */
export const OPENING_TEMPLATE_LEAD_SOURCES = ["meta_lead_ad", "site_lead"] as const;

export type OpeningTemplateLeadSource = (typeof OPENING_TEMPLATE_LEAD_SOURCES)[number];

export function isOpeningTemplateLeadSource(source: unknown): boolean {
  const s = String(source ?? "").trim();
  return (OPENING_TEMPLATE_LEAD_SOURCES as readonly string[]).includes(s);
}

/** איפוס מצב ליד ל«טמפלייט» כששולחים טמפלייט פתיחה מחדש (כולל לידים שסומנו לא רלוונטי). */
export function buildTemplateIncomingContactPatch(
  nowIso: string,
  source: OpeningTemplateLeadSource = "meta_lead_ad"
): Record<string, unknown> {
  return {
    ...salesFlowOpeningResetPatch(),
    source,
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

export type LeadTemplateRenderOpts = {
  firstName?: string;
  bodyParams?: string[];
  components?: unknown;
  componentsByName?: Record<string, unknown>;
};

/** Build a dashboard preview from stored Meta template components. */
export function previewFromWhatsappTemplateComponents(
  components: unknown
): LeadTemplatePreview | null {
  if (!Array.isArray(components)) return null;
  let header: string | undefined;
  let body = "";
  let footer: string | undefined;
  const buttons: string[] = [];
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { type?: unknown; text?: unknown; buttons?: unknown };
    const type = String(c.type ?? "").toUpperCase();
    if (type === "HEADER") {
      const t = String(c.text ?? "").trim();
      if (t) header = t;
    } else if (type === "BODY") {
      const t = String(c.text ?? "");
      if (t.trim()) body = t;
    } else if (type === "FOOTER") {
      const t = String(c.text ?? "").trim();
      if (t) footer = t;
    } else if (type === "BUTTONS" && Array.isArray(c.buttons)) {
      for (const b of c.buttons) {
        if (!b || typeof b !== "object") continue;
        const label = String((b as { text?: unknown }).text ?? "").trim();
        if (label) buttons.push(label);
      }
    }
  }
  if (!body.trim()) return null;
  return {
    ...(header ? { header } : {}),
    body,
    ...(buttons.length ? { buttons } : {}),
    ...(footer ? { footer } : {}),
  };
}

function renderPreviewText(
  preview: LeadTemplatePreview,
  firstName: string,
  extraParams?: string[]
): string {
  const lines: string[] = [];
  if (preview.header?.trim()) lines.push(preview.header.trim());
  const values = extraParams?.length ? extraParams : [firstName];
  lines.push(
    preview.body.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1) return "";
      return values[n - 1] ?? "";
    })
  );
  if (preview.footer?.trim()) lines.push(preview.footer.trim());

  let text = lines.join("\n\n");
  for (const btn of preview.buttons ?? []) {
    const label = String(btn ?? "").trim();
    if (label) text += `\n\n[כפתור: ${label}]`;
  }
  return text;
}

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
    header: "היי! כאן סאנגה יוגה",
    body: [
      "מתלבטים אם לתרגל איתנו יוגה?",
      "3 שאלות כדי שנתאים לכם את האימון המושלם!",
      "קליק👇",
    ].join("\n"),
    buttons: ["בואו נתחיל!"],
    footer: "דם המכבים 36 מודיעין",
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
  opts?: LeadTemplateRenderOpts
): string {
  const key = String(templateName ?? "").trim() || "lead_welcome";
  const firstName = String(opts?.firstName ?? "").trim() || "שלום";
  // Live Meta components win — the registry is only a fallback for old rows.
  const preview =
    previewFromWhatsappTemplateComponents(
      opts?.components ?? opts?.componentsByName?.[key]
    ) ?? LEAD_TEMPLATE_REGISTRY[key];
  if (!preview) {
    return `נשלח טמפלייט פתיחה (${key})`;
  }
  return renderPreviewText(preview, firstName, opts?.bodyParams);
}

/** @deprecated Use renderLeadTemplateMessageContent — kept for call sites. */
export function formatLeadTemplateMessageContent(
  templateName: string,
  opts?: LeadTemplateRenderOpts
): string {
  return renderLeadTemplateMessageContent(templateName, opts);
}

/** האם ההודעה היא placeholder «נשלח טמפלייט…» שדורש העשרה לתצוגה. */
export function leadTemplatePlaceholderNeedsEnrichment(content: string): boolean {
  return LEAD_TEMPLATE_PLACEHOLDER_RE.test(String(content ?? "").trim());
}

export function leadTemplateNameFromPlaceholder(content: string): string | null {
  const m = String(content ?? "").trim().match(LEAD_TEMPLATE_PLACEHOLDER_RE);
  const name = String(m?.[1] ?? "").trim();
  return name || null;
}

/** משדרג רשומות ישנות «נשלח טמפלייט…» לטקסט מלא לתצוגה בדשבורד. */
export function resolveLeadTemplateDisplayContent(
  content: string,
  opts?: LeadTemplateRenderOpts
): string {
  const raw = String(content ?? "").trim();
  const name = leadTemplateNameFromPlaceholder(raw);
  if (!name) return raw;
  return renderLeadTemplateMessageContent(name, opts);
}

/** ליד שקיבל טמפלייט ועדיין לא התחיל שיחה (לא ענה / לא התקדם בפלואו). */
export function isLeadTemplateOnlyContact(input: ContactStatusInput): boolean {
  if (!isOpeningTemplateLeadSource(input.source)) return false;
  if (input.opted_out === true) return false;
  if (input.not_relevant_at) return false;
  if (input.human_requested_at) return false;
  if (input.trial_registered === true || input.session_phase === "registered") return false;

  const stage = Number(input.wa_followup_stage ?? 0);
  if (stage > 0) return false;

  return String(input.session_phase ?? "").trim() === "opening";
}
