import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isNotificationEnabled } from "@/lib/notifications/getNotificationSettings";
import { resolveOwnerPhoneForBusiness } from "@/lib/notifications/resolveOwnerPhone";
import { sendOwnerNotification, type OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import { normalizePhone } from "@/lib/phone-normalize";

function bodyParams(...texts: string[]): OwnerTemplateComponent[] {
  return [
    {
      type: "body",
      parameters: texts.map((text) => ({ type: "text", text: String(text ?? "").slice(0, 900) })),
    },
  ];
}

function formatLeadPhoneDisplay(phone: string): string {
  const d = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) {
    return `0${d.slice(3)}`;
  }
  return d;
}

function formatTimeHe(iso: string): string {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

async function sendIfEnabled(input: {
  businessId: number;
  key: Parameters<typeof isNotificationEnabled>[1];
  templateName: string;
  components: OwnerTemplateComponent[];
}): Promise<void> {
  const enabled = await isNotificationEnabled(input.businessId, input.key);
  if (!enabled) return;

  const ownerPhone = await resolveOwnerPhoneForBusiness(input.businessId);
  if (!ownerPhone) {
    console.warn("[notifications] no owner phone for business", input.businessId);
    return;
  }

  const result = await sendOwnerNotification({
    ownerPhone,
    templateName: input.templateName,
    components: input.components,
  });

  if (!result.ok) {
    console.warn("[notifications] send failed:", input.templateName, result.error);
  }
}

export async function triggerNewLeadNotification(input: {
  businessId: number;
  businessName: string;
  leadPhone: string;
  atIso?: string;
}): Promise<void> {
  await sendIfEnabled({
    businessId: input.businessId,
    key: "new_lead",
    templateName: "new_lead_notification",
    components: bodyParams(
      input.businessName.trim() || "העסק שלך",
      formatLeadPhoneDisplay(input.leadPhone),
      formatTimeHe(input.atIso ?? new Date().toISOString())
    ),
  });
}

export async function triggerHumanRequestedNotification(input: {
  businessId: number;
  leadPhone: string;
}): Promise<void> {
  await sendIfEnabled({
    businessId: input.businessId,
    key: "human_requested",
    templateName: "human_agent_request",
    components: bodyParams(formatLeadPhoneDisplay(input.leadPhone)),
  });
}

export async function triggerLeadRegisteredNotification(input: {
  businessId: number;
  leadPhone: string;
}): Promise<void> {
  await sendIfEnabled({
    businessId: input.businessId,
    key: "lead_registered",
    templateName: "lead_registered",
    components: bodyParams(formatLeadPhoneDisplay(input.leadPhone)),
  });
}

export async function triggerBotPausedWaitingNotification(input: {
  businessId: number;
  conversationId: string;
  leadPhone: string;
}): Promise<void> {
  const enabled = await isNotificationEnabled(input.businessId, "bot_paused_waiting");
  if (!enabled) return;

  const ownerPhone = await resolveOwnerPhoneForBusiness(input.businessId);
  if (!ownerPhone) return;

  const result = await sendOwnerNotification({
    ownerPhone,
    templateName: "bot_paused_waiting",
    components: bodyParams(formatLeadPhoneDisplay(input.leadPhone)),
  });

  if (result.ok) {
    const admin = createSupabaseAdminClient();
    await admin
      .from("conversations")
      .update({ paused_notification_sent: true, updated_at: new Date().toISOString() })
      .eq("id", input.conversationId);
  }
}

export async function triggerCtaNoSignupNotification(input: {
  businessId: number;
  conversationId: string;
  leadPhone: string;
}): Promise<void> {
  const enabled = await isNotificationEnabled(input.businessId, "cta_no_signup");
  if (!enabled) return;

  const ownerPhone = await resolveOwnerPhoneForBusiness(input.businessId);
  if (!ownerPhone) return;

  const result = await sendOwnerNotification({
    ownerPhone,
    templateName: "lead_cta_no_signup",
    components: bodyParams(formatLeadPhoneDisplay(input.leadPhone)),
  });

  if (result.ok) {
    const admin = createSupabaseAdminClient();
    await admin
      .from("conversations")
      .update({ cta_notification_sent: true, updated_at: new Date().toISOString() })
      .eq("id", input.conversationId);
  }
}

export async function triggerDailySummaryNotification(input: {
  businessId: number;
  dateLabel: string;
  newLeads: number;
  openConversations: number;
  ctaReached: number;
  registered: number;
}): Promise<void> {
  await sendIfEnabled({
    businessId: input.businessId,
    key: "daily_summary",
    templateName: "daily_summary",
    components: bodyParams(
      input.dateLabel,
      String(input.newLeads),
      String(input.openConversations),
      String(input.ctaReached),
      String(input.registered)
    ),
  });

  const admin = createSupabaseAdminClient();
  await admin
    .from("notification_settings")
    .upsert(
      {
        business_id: input.businessId,
        last_daily_summary_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" } as { onConflict: string }
    );
}
