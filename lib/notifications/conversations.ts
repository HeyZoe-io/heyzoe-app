import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";

export type ConversationRow = {
  id: string;
  business_id: number;
  phone: string;
  session_id: string | null;
  bot_paused: boolean;
  paused_notification_sent: boolean;
  cta_clicked_at: string | null;
  cta_notification_sent: boolean;
};

function normalizeLeadPhone(phone: string): string {
  return normalizePhone(phone) ?? String(phone ?? "").replace(/\D/g, "");
}

/** יוצר/מעדכן שורת conversations לליד */
export async function ensureConversation(input: {
  businessId: number;
  phone: string;
  sessionId: string;
}): Promise<{ isNew: boolean; row: ConversationRow | null }> {
  const admin = createSupabaseAdminClient();
  const business_id = input.businessId;
  const phone = normalizeLeadPhone(input.phone);
  const session_id = String(input.sessionId ?? "").trim();

  const { data: existing } = await admin
    .from("conversations")
    .select("id, business_id, phone, session_id, bot_paused, paused_notification_sent, cta_clicked_at, cta_notification_sent")
    .eq("business_id", business_id)
    .eq("phone", phone)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("conversations")
      .update({ session_id, updated_at: new Date().toISOString() } as Record<string, unknown>)
      .eq("id", existing.id);
    return { isNew: false, row: existing as ConversationRow };
  }

  const insertPayload = {
    business_id,
    phone,
    session_id,
    bot_paused: false,
    paused_notification_sent: false,
    cta_notification_sent: false,
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await admin
    .from("conversations")
    .insert(insertPayload)
    .select("id, business_id, phone, session_id, bot_paused, paused_notification_sent, cta_clicked_at, cta_notification_sent")
    .single();

  if (error) {
    console.warn("[notifications] ensureConversation insert:", error.message);
    return { isNew: true, row: null };
  }

  return { isNew: true, row: inserted as ConversationRow };
}

export async function setConversationBotPaused(input: {
  businessId: number;
  phone: string;
  sessionId: string;
  paused: boolean;
}): Promise<void> {
  await ensureConversation({
    businessId: input.businessId,
    phone: input.phone,
    sessionId: input.sessionId,
  });

  const admin = createSupabaseAdminClient();
  const phone = normalizeLeadPhone(input.phone);
  const patch: Record<string, unknown> = {
    bot_paused: input.paused,
    updated_at: new Date().toISOString(),
  };
  if (!input.paused) {
    patch.paused_notification_sent = false;
  }

  const { error } = await admin
    .from("conversations")
    .update(patch)
    .eq("business_id", input.businessId)
    .eq("phone", phone);

  if (error) console.warn("[notifications] setConversationBotPaused:", error.message);
}

export async function markConversationCtaClicked(input: {
  businessId: number;
  phone: string;
  sessionId: string;
}): Promise<void> {
  await ensureConversation(input);
  const admin = createSupabaseAdminClient();
  const phone = normalizeLeadPhone(input.phone);
  const now = new Date().toISOString();

  const { error } = await admin
    .from("conversations")
    .update({
      cta_clicked_at: now,
      cta_notification_sent: false,
      updated_at: now,
    })
    .eq("business_id", input.businessId)
    .eq("phone", phone);

  if (error) console.warn("[notifications] markConversationCtaClicked:", error.message);
}
