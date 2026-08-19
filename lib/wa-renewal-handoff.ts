import { normalizeSalesFlowGreetingToken } from "@/lib/sales-flow-start-triggers";

/** Quick-reply labels from membership/sessions expiring template presets. */
export const RENEWAL_MEMBERSHIP_BUTTON_LABEL = "חידוש מנוי";
export const RENEWAL_SESSIONS_BUTTON_LABEL = "חידוש כרטיסיה";

export const RENEWAL_HANDOFF_REPLY =
  "אין בעיה, מעבירה את בקשת החידוש לצוות המטפל — יחזרו אלייך בהקדם 💜";

export const RENEWAL_HANDOFF_MODEL = "renewal_template_team_handoff";

const RENEWAL_HANDOFF_TOKENS = new Set([
  normalizeSalesFlowGreetingToken(RENEWAL_MEMBERSHIP_BUTTON_LABEL),
  normalizeSalesFlowGreetingToken(RENEWAL_SESSIONS_BUTTON_LABEL),
  normalizeSalesFlowGreetingToken("אשמח לחדש מנוי"),
  normalizeSalesFlowGreetingToken("אשמח לחדש כרטיסיה"),
  normalizeSalesFlowGreetingToken("אשמח לחדש כרטיסייה"),
]);

/**
 * Template-button (or instructed typed phrase) that must go to human handoff,
 * not the sales-flow classifiers.
 */
export function isRenewalTemplateHandoffText(raw: string): boolean {
  const normalized = normalizeSalesFlowGreetingToken(raw);
  return RENEWAL_HANDOFF_TOKENS.has(normalized);
}
