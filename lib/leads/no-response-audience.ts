/**
 * Extra no_response audience rules. Existing silence / opt-out / episode
 * checks stay in no-response-reengage.ts. These only decide whether the
 * silent contact is a sales lead Zoe actually spoke with.
 */

export const NO_RESPONSE_HUMAN_TOUCH_DAYS = 7;
export const NO_RESPONSE_HUMAN_TOUCH_MS = NO_RESPONSE_HUMAN_TOUCH_DAYS * 24 * 60 * 60 * 1000;

/**
 * Phases where Zoe is inside the sales flow.
 * opening = inbound chat before the flow starts (support / greeting / other).
 * registered = already converted (also excluded by waNoResponseEligible).
 */
export const NO_RESPONSE_SALES_PHASES = [
  "warmup",
  "schedule_date",
  "schedule_time",
  "call_schedule_day",
  "call_schedule_time",
  "cta",
] as const;

const HUMAN_OUTBOUND_MODELS = new Set(["wa_business_app", "manual_handoff"]);

export type NoResponseAudienceMessage = {
  role: string;
  model_used?: string | null;
  created_at: string;
};

export type NoResponseAudienceBlock =
  | "no_zoe_conversation"
  | "not_sales_phase"
  | "arbox_member"
  | "member_sync_log"
  | "human_touch";

export function isNoResponseSalesPhase(phase: string | null | undefined): boolean {
  const value = String(phase ?? "").trim();
  return (NO_RESPONSE_SALES_PHASES as readonly string[]).includes(value);
}

/** Dashboard manual send or a WhatsApp Business app echo. */
export function isHumanOutboundModel(model: string | null | undefined): boolean {
  return HUMAN_OUTBOUND_MODELS.has(String(model ?? "").trim());
}

/** Meta template sends. Not a Zoe conversation turn. */
export function isTemplateOutboundModel(model: string | null | undefined): boolean {
  return String(model ?? "").trim() === "lead_template";
}

/** Assistant turn written by Zoe (Claude or a sales-flow script), not staff or a template. */
export function isZoeAssistantModel(model: string | null | undefined): boolean {
  const value = String(model ?? "").trim();
  if (!value) return false;
  if (isHumanOutboundModel(value) || isTemplateOutboundModel(value)) return false;
  return true;
}

/**
 * Rules that fail for this silence episode. Empty means the audience checks pass.
 * Order is R1, R2, R3a, R3b, R4.
 */
export function noResponseAudienceBlocks(input: {
  sessionPhase: string | null | undefined;
  arboxIsMember: boolean;
  inMemberSyncLog: boolean;
  messages: NoResponseAudienceMessage[];
  lastUserAtIso: string;
  nowMs: number;
}): NoResponseAudienceBlock[] {
  const userMs = Date.parse(String(input.lastUserAtIso ?? "").trim());
  const blocks: NoResponseAudienceBlock[] = [];
  const inEpisode = (createdAt: string): boolean => {
    const ms = Date.parse(createdAt);
    return Number.isFinite(ms) && Number.isFinite(userMs) && ms >= userMs && ms <= input.nowMs;
  };
  const userCount = input.messages.filter((m) => m.role === "user" && inEpisode(m.created_at)).length;
  const zoeCount = input.messages.filter(
    (m) => m.role === "assistant" && isZoeAssistantModel(m.model_used) && inEpisode(m.created_at)
  ).length;
  if (userCount < 1 || zoeCount < 1) blocks.push("no_zoe_conversation");
  if (!isNoResponseSalesPhase(input.sessionPhase)) blocks.push("not_sales_phase");
  if (input.arboxIsMember) blocks.push("arbox_member");
  if (input.inMemberSyncLog) blocks.push("member_sync_log");

  const touchFromMs = input.nowMs - NO_RESPONSE_HUMAN_TOUCH_MS;
  const human = input.messages.some((m) => {
    if (m.role !== "assistant" || !isHumanOutboundModel(m.model_used)) return false;
    const ms = Date.parse(m.created_at);
    if (!Number.isFinite(ms) || ms > input.nowMs) return false;
    const afterUser = Number.isFinite(userMs) && ms > userMs;
    const withinWindow = ms >= touchFromMs;
    return afterUser || withinWindow;
  });
  if (human) blocks.push("human_touch");
  return blocks;
}
