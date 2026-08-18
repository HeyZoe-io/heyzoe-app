import type { BusinessContentLanguage } from "@/lib/business-content-lang";
import { metaWhatsNextBody } from "@/lib/business-content-lang";
import { waLabelMatches } from "@/lib/wa-menu-choice";
import type { SalesFlowCtaButton, SalesFlowCtaKind } from "@/lib/sales-flow";

export const SALES_FLOW_CTA_COMPACT_MODEL = "sales_flow_cta_compact";
export const SALES_FLOW_CTA_HAVE_A_QUESTION_MODEL = "sales_flow_cta_have_a_question";

const REGISTRATION_CTA_KINDS: SalesFlowCtaKind[] = ["trial", "workshop_purchase", "course_enroll"];

export function ctaHaveAQuestionLabel(lang: BusinessContentLanguage = "he"): string {
  return lang === "en" ? "I have a question" : "יש לי שאלה";
}

export function ctaHaveAQuestionReply(lang: BusinessContentLanguage = "he"): string {
  return lang === "en" ? "Happy to help, what's your question?" : "בשמחה, מה השאלה?";
}

export function ctaCompactFollowupBody(lang: BusinessContentLanguage = "he"): string {
  return metaWhatsNextBody(lang);
}

export function isCtaHaveAQuestionMessage(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  return waLabelMatches(t, ctaHaveAQuestionLabel("he")) || waLabelMatches(t, ctaHaveAQuestionLabel("en"));
}

export function pickRegistrationCtaButton(
  buttons: SalesFlowCtaButton[]
): SalesFlowCtaButton | null {
  for (const kind of REGISTRATION_CTA_KINDS) {
    const b = buttons.find((x) => x.kind === kind && String(x.label ?? "").trim());
    if (b) return b;
  }
  return null;
}

export function buildCompactCtaMenuLabels(
  buttons: SalesFlowCtaButton[],
  lang: BusinessContentLanguage = "he"
): string[] {
  const register = pickRegistrationCtaButton(buttons)?.label.trim() ?? "";
  const question = ctaHaveAQuestionLabel(lang);
  return [register, question].filter((l) => l.length > 0).slice(0, 3);
}
