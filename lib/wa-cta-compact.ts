import type { BusinessContentLanguage } from "@/lib/business-content-lang";
import { metaWhatsNextBody } from "@/lib/business-content-lang";
import { findWaMenuOptionIndex, waLabelMatches } from "@/lib/wa-menu-choice";
import type { SalesFlowConfig, SalesFlowCtaButton, SalesFlowCtaKind } from "@/lib/sales-flow";

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

type SalesFlowCtaLabelSource = Pick<
  SalesFlowConfig,
  "cta_buttons" | "cta_workshop_buttons" | "cta_course_buttons" | "followup_after_next_class_options"
>;

/** תוויות כפתורי CTA / תפריט קומפקטי / תפריט המשך — כולל חיתוך וואטסאפ. */
export function collectSalesFlowCtaChoiceLabels(
  cfg: SalesFlowCtaLabelSource | null | undefined,
  lang: BusinessContentLanguage = "he"
): string[] {
  if (!cfg) return [];
  const labels: string[] = [];
  const push = (raw: string) => {
    const t = String(raw ?? "").trim();
    if (t) labels.push(t);
  };
  const buttonGroups = [cfg.cta_buttons, cfg.cta_workshop_buttons, cfg.cta_course_buttons];
  for (const buttons of buttonGroups) {
    const list = Array.isArray(buttons) ? buttons : [];
    for (const b of list) push(String(b?.label ?? ""));
    for (const compact of buildCompactCtaMenuLabels(list, lang)) push(compact);
  }
  for (const opt of cfg.followup_after_next_class_options ?? []) push(String(opt ?? ""));
  push(ctaHaveAQuestionLabel(lang));
  push(ctaHaveAQuestionLabel(lang === "en" ? "he" : "en"));
  return [...new Set(labels)];
}

export function inboundMatchesSalesFlowCtaChoice(raw: string, labels: string[]): boolean {
  const t = String(raw ?? "").trim();
  if (!t || !labels.length) return false;
  return findWaMenuOptionIndex(t, undefined, labels) >= 0;
}

const DEFAULT_CTA_MENU_MODELS = new Set([
  "sales_flow_cta",
  SALES_FLOW_CTA_COMPACT_MODEL,
  SALES_FLOW_CTA_HAVE_A_QUESTION_MODEL,
  "sf_cta_reached",
  "sf_recover_to_cta",
  "flow_continuation_cta",
  "flow_continuation_skip_schedule_to_cta",
  "flow_continuation_call_schedule_disabled",
]);

/**
 * לחיצה על כפתור CTA (למשל «הרשמה לשיעור ניסיון») בזמן הנעה לפעולה
 * לא צריכה ליפול ל־FAQ של «אימון ניסיון» — הלינק נשלח ב־CTA handler.
 */
export function shouldDeferTrialTopicToCtaHandler(input: {
  inbound: string;
  sessionPhase?: string | null;
  lastAssistantModel?: string | null;
  ctaLabels: string[];
  ctaMenuModels?: ReadonlySet<string>;
}): boolean {
  if (!inboundMatchesSalesFlowCtaChoice(input.inbound, input.ctaLabels)) return false;
  if (String(input.sessionPhase ?? "").trim() === "cta") return true;
  const model = String(input.lastAssistantModel ?? "").trim();
  const models = input.ctaMenuModels ?? DEFAULT_CTA_MENU_MODELS;
  return Boolean(model) && models.has(model);
}
