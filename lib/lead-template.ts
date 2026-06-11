import type { ContactStatusInput } from "@/lib/contact-status";

/** model_used ב-messages לשליחת טמפלייט פתיחה ממודעת Meta */
export const LEAD_TEMPLATE_MODEL = "lead_template";

/** 6 שעות אחרי טמפלייט פתיחה בלי תגובת ליד → ללא מענה + CRM */
export const TEMPLATE_NO_RESPONSE_AFTER_MS = 6 * 60 * 60 * 1000;

export function templateNoResponseDueAtIso(fromMs: number = Date.now()): string {
  return new Date(fromMs + TEMPLATE_NO_RESPONSE_AFTER_MS).toISOString();
}

export function formatLeadTemplateMessageContent(templateName: string): string {
  const name = String(templateName ?? "").trim() || "lead_welcome";
  return `נשלח טמפלייט פתיחה (${name})`;
}

/** ליד שקיבל טמפלייט ועדיין לא התחיל שיחה (לא ענה / לא התקדם בפלואו). */
export function isLeadTemplateOnlyContact(input: ContactStatusInput): boolean {
  if (String(input.source ?? "").trim() !== "meta_lead_ad") return false;
  if (input.opted_out === true) return false;
  if (input.not_relevant_at) return false;
  if (input.trial_registered === true || input.session_phase === "registered") return false;

  const stage = Number(input.wa_followup_stage ?? 0);
  if (stage > 0) return false;

  return String(input.session_phase ?? "").trim() === "opening";
}
