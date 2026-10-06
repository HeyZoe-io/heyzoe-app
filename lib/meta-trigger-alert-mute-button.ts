/**
 * Quick reply on MARKETING templates. Stops one trigger (or one non-trigger
 * template) for the customer who tapped it. Does not set marketing_opted_out.
 */

export const TRIGGER_ALERT_MUTE_BUTTON_HE = "הפסק התראה";
export const TRIGGER_ALERT_MUTE_BUTTON_EN = "Stop this alert";

function normalizeButtonText(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isTriggerAlertMuteButtonText(raw: string): boolean {
  const text = normalizeButtonText(raw);
  if (!text) return false;
  return text === TRIGGER_ALERT_MUTE_BUTTON_HE || text === TRIGGER_ALERT_MUTE_BUTTON_EN.toLowerCase();
}

export function triggerAlertMuteButtonText(language: string): string {
  const lang = String(language ?? "")
    .trim()
    .toLowerCase();
  if (lang.startsWith("he") || lang.startsWith("iw") || !lang) return TRIGGER_ALERT_MUTE_BUTTON_HE;
  return TRIGGER_ALERT_MUTE_BUTTON_EN;
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

/** Inserts the mute quick reply before URL buttons. Call this before the marketing opt-out button. */
export function withTriggerAlertMuteButton(components: unknown[], language: string): unknown[] {
  const label = triggerAlertMuteButtonText(language);
  const next = components.map((component) =>
    component && typeof component === "object" ? { ...(component as Record<string, unknown>) } : component
  );
  const index = next.findIndex(isButtonsComponent);
  const mute = { type: "QUICK_REPLY", text: label };

  if (index < 0) {
    next.push({ type: "BUTTONS", buttons: [mute] });
    return next;
  }

  const block = next[index] as { type: string; buttons?: unknown[] };
  const buttons = Array.isArray(block.buttons) ? [...block.buttons] : [];
  if (buttons.some((button) => isTriggerAlertMuteButtonText(buttonText(button)))) return next;
  if (buttons.length >= 10) {
    console.error("[meta-trigger-alert-mute-button] skipped — template already has 10 buttons");
    return next;
  }

  const firstNonQuickReply = buttons.findIndex((button) => buttonType(button) !== "QUICK_REPLY");
  const insertAt = firstNonQuickReply < 0 ? buttons.length : firstNonQuickReply;
  buttons.splice(insertAt, 0, mute);
  next[index] = { ...block, buttons };
  return next;
}
