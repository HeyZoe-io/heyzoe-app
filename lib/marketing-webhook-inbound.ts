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
 * מנוע שיווק WhatsApp (מספר 1179786855208358 בלבד).
 *
 * הזרימה (בפועל ב־{@link handleMarketingInboundText} + {@link runMarketingFlowFromNode}):
 * 1. טעינת nodes/edges/settings + marketing_flow_sessions לפי מספר הטלפון של השולח.
 * 2. אם אין session — יצירה עם `current_node_id` = נוד התחלה (`is_start` או root).
 * 3. קריאת הנוד הנוכחי; אם `question` — התאמת תשובה לכפתור לפי `marketing_flow_edges.label`.
 * 4. אחרת (לא באמצע שאלה) — חזרה לנוד ההתחלה.
 * 5. שליחת תוכן הנודים הבאים דרך Meta Cloud API (`phone_number_id` של ערוץ השיווק).
 * 6. עדכון `marketing_flow_sessions.current_node_id` (ופולואפ אם נוד `followup`).
 *
 * פולואפ: `followup_wake_at` + cron כל ~5 דקות (`/api/cron/marketing-followup`).
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
