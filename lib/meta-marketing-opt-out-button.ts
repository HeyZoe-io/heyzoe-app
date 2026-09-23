/**
 * Meta marketing opt-out on a template is a QUICK_REPLY whose label is fixed by language.
 * WhatsApp Manager calls it "Marketing opt-out". Graph has no separate button type.
 * Meta does not append this button at send time — it has to be in the template components.
 * Only MARKETING templates. Utility stays without it so reminders are not reclassified.
 */

export const MARKETING_OPT_OUT_BUTTON_HE = "הפסקת הודעות הקידום";
export const MARKETING_OPT_OUT_BUTTON_EN = "Stop promotions";

const MAX_TEMPLATE_BUTTONS = 10;

export function marketingOptOutButtonText(language: string): string {
  const lang = String(language ?? "")
    .trim()
    .toLowerCase();
  if (lang.startsWith("he") || lang.startsWith("iw")) return MARKETING_OPT_OUT_BUTTON_HE;
  return MARKETING_OPT_OUT_BUTTON_EN;
}

export function isMarketingOptOutButtonText(raw: string): boolean {
  const text = String(raw ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!text) return false;
  return text === MARKETING_OPT_OUT_BUTTON_HE || text === MARKETING_OPT_OUT_BUTTON_EN.toLowerCase();
}

function isButtonsComponent(component: unknown): component is { type: string; buttons?: unknown[] } {
  if (!component || typeof component !== "object") return false;
  return String((component as { type?: unknown }).type ?? "").trim().toUpperCase() === "BUTTONS";
}

function buttonText(button: unknown): string {
  if (!button || typeof button !== "object") return "";
  return String((button as { text?: unknown }).text ?? "").trim();
}

function buttonType(button: unknown): string {
  if (!button || typeof button !== "object") return "";
  return String((button as { type?: unknown }).type ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Appends the locale-locked marketing opt-out quick reply.
 * Leaves the payload unchanged when the label is already present or the button cap is full.
 */
export function withMarketingOptOutButton(components: unknown[], language: string): unknown[] {
  const label = marketingOptOutButtonText(language);
  const next = components.map((component) =>
    component && typeof component === "object" ? { ...(component as Record<string, unknown>) } : component
  );
  const index = next.findIndex(isButtonsComponent);
  const optOut = { type: "QUICK_REPLY", text: label };

  if (index < 0) {
    next.push({ type: "BUTTONS", buttons: [optOut] });
    return next;
  }

  const block = next[index] as { type: string; buttons?: unknown[] };
  const buttons = Array.isArray(block.buttons) ? [...block.buttons] : [];
  if (buttons.some((button) => isMarketingOptOutButtonText(buttonText(button)))) {
    return next;
  }
  if (buttons.length >= MAX_TEMPLATE_BUTTONS) {
    console.error("[meta-marketing-opt-out-button] skipped — template already has 10 buttons");
    return next;
  }

  const firstNonQuickReply = buttons.findIndex((button) => buttonType(button) !== "QUICK_REPLY");
  const insertAt = firstNonQuickReply < 0 ? buttons.length : firstNonQuickReply;
  buttons.splice(insertAt, 0, optOut);
  next[index] = { ...block, buttons };
  return next;
}
