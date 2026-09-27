/**
 * Extra no_response audience rules. Existing silence / opt-out / episode
 * checks stay in no-response-reengage.ts. registered stays excluded there
 * (waNoResponseEligible). opening is eligible.
 */

/** Block only when a human outbound is this recent. Order does not matter. */
export const NO_RESPONSE_HUMAN_COOLDOWN_HOURS = 48;
export const NO_RESPONSE_HUMAN_COOLDOWN_MS =
  NO_RESPONSE_HUMAN_COOLDOWN_HOURS * 60 * 60 * 1000;

/** Block when any lead_template was sent inside this window. Any trigger counts. */
export const NO_RESPONSE_RECENT_TEMPLATE_HOURS = 72;
export const NO_RESPONSE_RECENT_TEMPLATE_MS =
  NO_RESPONSE_RECENT_TEMPLATE_HOURS * 60 * 60 * 1000;

const HUMAN_OUTBOUND_MODELS = new Set(["wa_business_app", "manual_handoff"]);

export type NoResponseAudienceMessage = {
  role: string;
  model_used?: string | null;
  created_at: string;
};

export type NoResponseAudienceBlock =
  | "no_zoe_conversation"
  | "arbox_member"
  | "member_sync_log"
  | "human_cooldown"
  | "recent_template";

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

function withinPast(createdAt: string, nowMs: number, windowMs: number): boolean {
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms > nowMs) return false;
  return ms >= nowMs - windowMs;
}

/**
 * Rules that fail for this silence episode. Empty means the audience checks pass.
 * Order is R1, R3a, R3b, R4, R5.
 */
export function noResponseAudienceBlocks(input: {
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
  if (input.arboxIsMember) blocks.push("arbox_member");
  if (input.inMemberSyncLog) blocks.push("member_sync_log");

  const human = input.messages.some(
    (m) =>
      m.role === "assistant" &&
      isHumanOutboundModel(m.model_used) &&
      withinPast(m.created_at, input.nowMs, NO_RESPONSE_HUMAN_COOLDOWN_MS)
  );
  if (human) blocks.push("human_cooldown");

  const recentTemplate = input.messages.some(
    (m) =>
      m.role === "assistant" &&
      isTemplateOutboundModel(m.model_used) &&
      withinPast(m.created_at, input.nowMs, NO_RESPONSE_RECENT_TEMPLATE_MS)
  );
  if (recentTemplate) blocks.push("recent_template");
  return blocks;
}
