import {
  dailySummaryOwnerEmail,
  humanRequestedOwnerEmail,
  leadRegisteredOwnerEmail,
} from "@/lib/email";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { gateOwnerNotification } from "@/lib/notifications/owner-notification-gate";
import {
  buildWarmupSummaryFromSession,
  fetchIdleLeadsLast24h,
  formatLeadIdentityLine,
  formatLeadPhoneDisplay,
  formatRegisteredAtHe,
  formatScheduleLine,
  loadContactFullName,
  resolveServiceNameForSession,
} from "@/lib/notifications/owner-email-context";
import { sendOwnerEmailIfEnabled } from "@/lib/notifications/sendOwnerEmailIfEnabled";
import { sendOwnerNotification, type OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";

function bodyParams(...texts: string[]): OwnerTemplateComponent[] {
  return [
    {
      type: "body",
      parameters: texts.map((text) => ({ type: "text", text: String(text ?? "").slice(0, 900) })),
    },
  ];
}

function headerAndBodyParams(headerText: string, ...bodyTexts: string[]): OwnerTemplateComponent[] {
  return [
    {
      type: "header",
      parameters: [{ type: "text", text: String(headerText ?? "").slice(0, 900) }],
    },
    {
      type: "body",
      parameters: bodyTexts.map((text) => ({
        type: "text",
        text: String(text ?? "").slice(0, 900),
      })),
    },
  ];
}

async function loadBusinessDisplayName(businessId: number): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("businesses").select("name").eq("id", businessId).maybeSingle();
  return String((data as { name?: string } | null)?.name ?? "").trim() || "העסק שלך";
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
  key: Parameters<typeof gateOwnerNotification>[1];
  templateName: string;
  components: OwnerTemplateComponent[];
}): Promise<void> {
  const gate = await gateOwnerNotification(input.businessId, input.key);
  if (!gate.allowed || !gate.ownerPhone) {
    if (gate.reason && gate.reason !== "setting_disabled") {
      console.info("[notifications] skip:", input.templateName, gate.reason, input.businessId);
    }
    return;
  }

  const result = await sendOwnerNotification({
    ownerPhone: gate.ownerPhone,
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
  const templateName = "new_lead_notification";
  const gate = await gateOwnerNotification(input.businessId, "new_lead");
  console.info("[new_lead_notification] gateOwnerNotification result", {
    businessId: input.businessId,
    leadPhone: input.leadPhone,
    allowed: gate.allowed,
    reason: gate.reason ?? null,
    hasOwnerPhone: Boolean(gate.ownerPhone),
  });
  if (!gate.allowed || !gate.ownerPhone) {
    console.info("[new_lead_notification] skip send", {
      businessId: input.businessId,
      leadPhone: input.leadPhone,
      reason: gate.reason ?? "no_owner_phone",
    });
    return;
  }

  console.info("[new_lead_notification] sending new_lead_notification", {
    businessId: input.businessId,
    leadPhone: input.leadPhone,
    templateName,
  });
  const result = await sendOwnerNotification({
    ownerPhone: gate.ownerPhone,
    templateName,
    components: bodyParams(
      input.businessName.trim() || "העסק שלך",
      formatLeadPhoneDisplay(input.leadPhone),
      formatTimeHe(input.atIso ?? new Date().toISOString())
    ),
  });
  if (result.ok) {
    console.info("[new_lead_notification] send ok", {
      businessId: input.businessId,
      leadPhone: input.leadPhone,
    });
  } else {
    console.warn("[new_lead_notification] send failed", {
      businessId: input.businessId,
      leadPhone: input.leadPhone,
      error: result.error,
    });
  }
}

export async function triggerHumanRequestedNotification(input: {
  businessId: number;
  leadPhone: string;
  requestedAtIso?: string;
}): Promise<void> {
  const phoneDisplay = formatLeadPhoneDisplay(input.leadPhone);
  const businessName = await loadBusinessDisplayName(input.businessId);
  await sendIfEnabled({
    businessId: input.businessId,
    key: "human_requested",
    templateName: "human_agent_request",
    components: bodyParams(businessName, phoneDisplay),
  });

  const fullName = await loadContactFullName(input.businessId, input.leadPhone);
  const identity = formatLeadIdentityLine(fullName, input.leadPhone);
  const requestedAt = formatRegisteredAtHe(input.requestedAtIso ?? new Date().toISOString());

  await sendOwnerEmailIfEnabled({
    businessId: input.businessId,
    settingKey: "human_requested_email",
    build: ({ businessName }) =>
      humanRequestedOwnerEmail({
        business_name: businessName,
        lead_identity: identity,
        requested_at: requestedAt,
      }),
  });
}

export async function triggerLeadRegisteredNotification(input: {
  businessId: number;
  leadPhone: string;
  businessSlug: string;
  sessionId: string;
  registeredAtIso?: string;
  scheduleDirectRegistration?: boolean;
  requestedDate?: string | null;
  requestedTime?: string | null;
}): Promise<void> {
  const directRegistration = input.scheduleDirectRegistration !== false;
  const phoneDisplay = formatLeadPhoneDisplay(input.leadPhone);
  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  const [fullName, serviceName, warmupSummary] = await Promise.all([
    loadContactFullName(input.businessId, input.leadPhone),
    slug && sessionId
      ? resolveServiceNameForSession({
          businessSlug: slug,
          sessionId,
          businessId: input.businessId,
        })
      : Promise.resolve(""),
    slug && sessionId
      ? buildWarmupSummaryFromSession({ business_slug: slug, session_id: sessionId })
      : Promise.resolve(""),
  ]);

  const leadName = String(fullName ?? "").trim() || "ליד";
  const serviceLabel = String(serviceName ?? "").trim() || "—";
  await sendIfEnabled({
    businessId: input.businessId,
    key: "lead_registered",
    templateName: directRegistration ? "lead_registered" : "lead_registered_with_time",
    components: directRegistration
      ? bodyParams(phoneDisplay)
      : bodyParams(
          phoneDisplay,
          leadName,
          serviceLabel,
          String(input.requestedDate ?? "").trim(),
          String(input.requestedTime ?? "").trim()
        ),
  });

  const identity = formatLeadIdentityLine(fullName, input.leadPhone);
  const schedule = formatScheduleLine({
    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
    scheduleDirectRegistration: input.scheduleDirectRegistration,
  });
  const registeredAt = formatRegisteredAtHe(input.registeredAtIso ?? new Date().toISOString());

  await sendOwnerEmailIfEnabled({
    businessId: input.businessId,
    settingKey: "lead_registered_email",
    build: ({ businessName }) =>
      leadRegisteredOwnerEmail({
        business_name: businessName,
        lead_identity: identity,
        service_name: serviceName,
        schedule,
        registered_at: registeredAt,
        warmup_summary: warmupSummary,
      }),
  });
}

export async function triggerBotPausedWaitingNotification(input: {
  businessId: number;
  conversationId: string;
  leadPhone: string;
}): Promise<void> {
  const gate = await gateOwnerNotification(input.businessId, "bot_paused_waiting");
  if (!gate.allowed || !gate.ownerPhone) return;

  const result = await sendOwnerNotification({
    ownerPhone: gate.ownerPhone,
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
  const gate = await gateOwnerNotification(input.businessId, "cta_no_signup");
  if (!gate.allowed || !gate.ownerPhone) return;

  const result = await sendOwnerNotification({
    ownerPhone: gate.ownerPhone,
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
  businessSlug: string;
  dateLabel: string;
  newLeads: number;
  /** שיחות (conversations) שנוצרו אתמול — template {{3}} */
  openConversations: number;
  ctaReached: number;
  registered: number;
}): Promise<void> {
  const businessName = await loadBusinessDisplayName(input.businessId);
  await sendIfEnabled({
    businessId: input.businessId,
    key: "daily_summary",
    templateName: "daily_summary",
    components: headerAndBodyParams(
      businessName,
      input.dateLabel,
      String(input.newLeads),
      String(input.registered)
    ),
  });

  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const idleLeads = await fetchIdleLeadsLast24h(input.businessId);

  await sendOwnerEmailIfEnabled({
    businessId: input.businessId,
    settingKey: "daily_summary_email",
    build: ({ businessName }) =>
      dailySummaryOwnerEmail({
        business_name: businessName,
        business_slug: slug,
        date_label: input.dateLabel,
        idle_count: idleLeads.length,
        idle_leads: idleLeads,
      }),
  });

  const { touchNotificationSettingsDailySummaryAt } = await import(
    "@/lib/notifications/getNotificationSettings"
  );
  await touchNotificationSettingsDailySummaryAt(input.businessId);
}
