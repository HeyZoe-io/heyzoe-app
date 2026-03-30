import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  verifyWebhookSignature,
  parseIncomingMessages,
  sendWhatsAppMessage,
  markMessageRead,
  resolveWaVerifyToken,
  resolveWaAppSecret,
  resolveWaSystemToken,
} from "@/lib/whatsapp";
import { getBusinessKnowledgePack, buildSystemPrompt } from "@/lib/business-context";
import { CLAUDE_CHAT_MODEL, CLAUDE_MAX_TOKENS, resolveClaudeApiKey, formatUserFacingClaudeError } from "@/lib/claude";
import { logMessage } from "@/lib/analytics";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// In-process dedup: prevents double-processing when Meta retries the webhook.
const processedMessageIds = new Set<string>();

// ─── GET — webhook verification ───────────────────────────────────────────────

export function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = resolveWaVerifyToken();
  if (!verifyToken) {
    console.error("[WA Webhook] WHATSAPP_VERIFY_TOKEN is not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  if (mode === "subscribe" && token === verifyToken && challenge) {
    console.info("[WA Webhook] Verification successful");
    return new Response(challenge, { status: 200 });
  }

  console.warn("[WA Webhook] Verification failed — token mismatch or missing params");
  return new Response("Forbidden", { status: 403 });
}

// ─── POST — incoming messages ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Read raw body for signature verification
  const rawBody = await req.text();

  // 2. Verify signature (skip if APP_SECRET not configured — dev only)
  const appSecret = resolveWaAppSecret();
  if (appSecret) {
    const signature = req.headers.get("x-hub-signature-256");
    if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
      console.warn("[WA Webhook] Invalid signature — rejected");
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 3. Always return 200 immediately — Meta will retry otherwise
  // Process async after responding
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("OK", { status: 200 });
  }

  await processIncoming(body).catch((e) =>
    console.error("[WA Webhook] processIncoming error:", e)
  );

  return new Response("OK", { status: 200 });
}

// ─── Core processing ──────────────────────────────────────────────────────────

async function processIncoming(body: unknown): Promise<void> {
  const messages = parseIncomingMessages(body);
  if (!messages.length) return;

  const systemToken = resolveWaSystemToken();
  const claudeApiKey = resolveClaudeApiKey();
  if (!systemToken || !claudeApiKey) {
    console.error("[WA Webhook] Missing WHATSAPP_SYSTEM_TOKEN or ANTHROPIC_API_KEY");
    return;
  }

  const supabase = createSupabaseAdminClient();
  const client   = new Anthropic({ apiKey: claudeApiKey });

  for (const msg of messages) {
    // Dedup
    if (processedMessageIds.has(msg.messageId)) {
      console.info(`[WA Webhook] Skipping duplicate message ${msg.messageId}`);
      continue;
    }
    processedMessageIds.add(msg.messageId);
    // Prevent unbounded growth
    if (processedMessageIds.size > 10_000) {
      const first = processedMessageIds.values().next().value;
      if (first) processedMessageIds.delete(first);
    }

    // Route: look up business by phone_number_id
    const { data: channel } = await supabase
      .from("whatsapp_channels")
      .select("business_slug, phone_number_id")
      .eq("phone_number_id", msg.phoneNumberId)
      .eq("is_active", true)
      .maybeSingle();

    if (!channel) {
      console.warn(`[WA Webhook] No active channel for phone_number_id: ${msg.phoneNumberId}`);
      continue;
    }

    const { business_slug } = channel;
    const sessionId = `wa_${msg.phoneNumberId}_${msg.from}`;

    // Mark as read (best-effort)
    markMessageRead(msg.phoneNumberId, msg.messageId, systemToken).catch(() => null);

    // Handle unsupported message types
    if (msg.type === "unsupported") {
      const replyText = "שלום! אני מטפלת בהודעות טקסט בלבד. שלחו לי שאלה בכתב ואשמח לעזור 😊";
      await sendWhatsAppMessage(msg.phoneNumberId, msg.from, replyText, systemToken);
      continue;
    }

    // Log incoming user message
    await logMessage({
      business_slug,
      role: "user",
      content: msg.text,
      session_id: sessionId,
    });

    // Build context & call Claude
    const knowledge   = await getBusinessKnowledgePack(business_slug);
    const systemPrompt = buildSystemPrompt(knowledge, business_slug, "whatsapp");

    let replyText: string;
    try {
      const response = await client.messages.create({
        model: CLAUDE_CHAT_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: msg.text }],
      });
      replyText = response.content[0]?.type === "text"
        ? response.content[0].text.trim()
        : formatUserFacingClaudeError(new Error("empty response"));
    } catch (e) {
      console.error(`[WA Webhook] Claude error for ${business_slug}:`, e);
      replyText = formatUserFacingClaudeError(e);
    }

    // Append CTA link if available
    const ctaText = knowledge?.ctaText?.trim();
    const ctaLink = knowledge?.ctaLink?.trim();
    if (ctaText && ctaLink) {
      replyText += `\n\n${ctaText}: ${ctaLink}`;
    }

    // Send reply via WhatsApp
    try {
      await sendWhatsAppMessage(msg.phoneNumberId, msg.from, replyText, systemToken);
    } catch (e) {
      console.error(`[WA Webhook] Send failed for ${msg.from}:`, e);
    }

    // Log assistant reply
    await logMessage({
      business_slug,
      role: "assistant",
      content: replyText,
      model_used: CLAUDE_CHAT_MODEL,
      session_id: sessionId,
    });
  }
}
