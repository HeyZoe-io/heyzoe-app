export const MARKETING_TRIGGER_TYPES = ["node_answered", "flow_completed", "call_day"] as const;

export type MarketingTriggerType = (typeof MARKETING_TRIGGER_TYPES)[number];

export type MarketingDelayDirection = "after" | "before";

const TRIGGER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMarketingTriggerType(value: string): value is MarketingTriggerType {
  return (MARKETING_TRIGGER_TYPES as readonly string[]).includes(value);
}

export function parseMarketingTriggerId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!TRIGGER_UUID_RE.test(s)) return null;
  return s;
}

export function marketingForcesDelayAfter(triggerType: string): boolean {
  return triggerType === "node_answered" || triggerType === "flow_completed";
}

export function marketingAllowsDelayBefore(triggerType: string): boolean {
  return triggerType === "call_day";
}

export function marketingDelayDirectionForTrigger(
  triggerType: string,
  stored: string | null | undefined
): MarketingDelayDirection {
  if (marketingForcesDelayAfter(triggerType)) return "after";
  const d = String(stored ?? "").trim().toLowerCase();
  return d === "before" ? "before" : "after";
}

/** Owner-notification templates that live on the same marketing WABA. */
export const MARKETING_SYSTEM_TEMPLATE_NAMES = new Set([
  "human_agent_request",
  "lead_registered",
  "lead_registered_with_time",
  "daily_summary",
  "bot_paused_waiting",
  "lead_cta_no_signup",
  "marketing_human_agent_request",
  "new_lead_notification",
]);

export function isMarketingSystemTemplateName(name: string): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  if (MARKETING_SYSTEM_TEMPLATE_NAMES.has(n)) return true;
  return n.startsWith("quota_warning_");
}

export const MARKETING_SYSTEM_TEMPLATE_LABELS: Record<string, string> = {
  human_agent_request: "נציג אנושי (לבעל עסק)",
  lead_registered: "ליד נרשם",
  lead_registered_with_time: "ליד נרשם + מועד",
  daily_summary: "סיכום יומי לבעלים",
  bot_paused_waiting: "הבוט הושהה",
  lead_cta_no_signup: "ליד לא נרשם",
  marketing_human_agent_request: "נציג אנושי (שיווק)",
  new_lead_notification: "ליד חדש לבעלים",
};

export function marketingSystemTemplateLabel(name: string): string {
  const n = String(name ?? "").trim();
  const known = MARKETING_SYSTEM_TEMPLATE_LABELS[n];
  if (known) return known;
  if (n.toLowerCase().startsWith("quota_warning_")) return "אזהרת מכסה";
  return n;
}
