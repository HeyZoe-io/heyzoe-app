import {
  parseMetaWebhook,
  explainMetaWebhookSkip,
  type WaIncomingMessage,
} from "@/lib/whatsapp";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { handleMarketingInboundText, loadMarketingFlowBundle } from "@/lib/marketing-flow-runtime";

/** HeyZoe marketing WhatsApp Cloud API phone_number_id — only this line uses the marketing flow. */
export const MARKETING_META_PHONE_NUMBER_ID = "1179786855208358";

function resolveMarketingPhoneNumberId(): string {
  return process.env.MARKETING_WHATSAPP_PHONE_NUMBER_ID?.trim() || MARKETING_META_PHONE_NUMBER_ID;
}

/**
 * Runs marketing automation for a verified Meta WABA JSON payload.
 * Call only when {@link isMarketingMetaInbound} is true (or after equivalent check).
 */
export async function processMarketingMetaInbound(metaPayload: Record<string, unknown>): Promise<void> {
  const msg = parseMetaWebhook(metaPayload);
  if (!msg) {
    console.info("[marketing-inbound] skip:", explainMetaWebhookSkip(metaPayload));
    return;
  }
  if (msg.type !== "text") {
    console.info("[marketing-inbound] skip: unsupported_message_type");
    return;
  }

  const marketingPid = resolveMarketingPhoneNumberId();
  if (String(msg.toNumber).trim() !== marketingPid) {
    console.warn("[marketing-inbound] phone_number_id mismatch (internal bug)", {
      expected: marketingPid,
      got: msg.toNumber,
    });
    return;
  }

  const admin = createSupabaseAdminClient();
  const bundle = await loadMarketingFlowBundle(admin);
  if (!bundle.channel?.is_active) {
    console.info("[marketing-inbound] skip: marketing_channel_inactive");
    return;
  }
  if (!bundle.settings?.is_active) {
    console.info("[marketing-inbound] skip: marketing_flow_inactive");
    return;
  }

  await handleMarketingInboundText({
    admin,
    channel: bundle.channel,
    settings: bundle.settings,
    nodes: bundle.nodes,
    edges: bundle.edges,
    fromE164: msg.from,
    text: msg.text,
    metaInteractiveReplyId: msg.metaInteractiveReplyId,
  });
}

/** True when this inbound Meta message is for the marketing phone_number_id only (no second parse). */
export function inboundTargetsMarketingLine(msg: WaIncomingMessage): boolean {
  return String(msg.toNumber).trim() === resolveMarketingPhoneNumberId();
}
