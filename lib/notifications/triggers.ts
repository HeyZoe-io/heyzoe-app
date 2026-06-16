import {
  dailySummaryOwnerEmail,
  humanRequestedOwnerEmail,
  leadRegisteredOwnerEmail,
} from "@/lib/email";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { gateOwnerNotification } from "@/lib/notifications/owner-notification-gate";
import {
  fetchIdleLeadsInWindow,
  formatLeadPhoneDisplay,
  formatRegisteredAtHe,
  formatScheduleLine,
  resolveServiceNameForSession,
} from "@/lib/notifications/owner-email-context";
import { sendOwnerEmailIfEnabled } from "@/lib/notifications/sendOwnerEmailIfEnabled";
import {
  dailySummaryDashboardUrl,
  fetchConversationsHeldYesterday,
  fetchNotRelevantYesterdayLeads,
  fetchRegisteredYesterdayLeads,
  formatDailySummaryLeadListForWa,
  formatDailySummaryNotRelevantLeadListForWa,
} from "@/lib/notifications/daily-summary-data";
import {
  buildDailySummaryWaParams,
  DAILY_SUMMARY_WA_TEMPLATE_NAME,
  buildHumanAgentRequestWaParams,
  buildLeadRegisteredWaParams,
  buildLeadRegisteredWithTimeWaParams,
  buildNewLeadNotificationWaParams,
  buildSinglePhoneWaParams,
} from "@/lib/notifications/owner-template-params";
import { sendOwnerNotification, type OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import {
  getOwnerNotificationMonitor,
  monitorWhatsappDiffersFromOwner,
} from "@/lib/notifications/owner-notification-monitor";
import { resolveWarmupSummaryForLeadRegistered } from "@/lib/notifications/warmup-summary";

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

async function sendOwnerWaMirrored(input: {
  businessId: number;
  ownerPhone: string;
  templateName: string;
  components: OwnerTemplateComponent[];
}): Promise<{ ok: boolean; error?: string }> {
  const result = await sendOwnerNotification({
    ownerPhone: input.ownerPhone,
    templateName: input.templateName,
    components: input.components,
  });
  if (!result.ok) return result;

  const monitor = getOwnerNotificationMonitor(input.businessId);
  if (monitor?.whatsapp && monitorWhatsappDiffersFromOwner(monitor, input.ownerPhone)) {
    const mirror = await sendOwnerNotification({
      ownerPhone: monitor.whatsapp,
      templateName: input.templateName,
      components: input.components,
    });
    if (!mirror.ok) {
      console.warn("[notifications] monitor WA failed:", input.templateName, mirror.error);
    }
  }
  return result;
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

  const result = await sendOwnerWaMirrored({
    businessId: input.businessId,
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
  const components = buildNewLeadNotificationWaParams({
    businessName: input.businessName,
    leadPhoneDisplay: formatLeadPhoneDisplay(input.leadPhone),
    atHe: formatTimeHe(input.atIso ?? new Date().toISOString()),
  });
  const result = await sendOwnerWaMirrored({
    businessId: input.businessId,
    ownerPhone: gate.ownerPhone,
    templateName,
    components,
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
  const requestedAtWa = formatRegisteredAtHe(input.requestedAtIso ?? new Date().toISOString());
  await sendIfEnabled({
    businessId: input.businessId,
    key: "human_requested",
    templateName: "human_agent_request",
    components: buildHumanAgentRequestWaParams({
      leadPhoneDisplay: phoneDisplay,
      requestedAtHe: requestedAtWa,
    }),
  });

  const requestedAt = formatRegisteredAtHe(input.requestedAtIso ?? new Date().toISOString());

  await sendOwnerEmailIfEnabled({
    businessId: input.businessId,
    settingKey: "human_requested_email",
    build: ({ businessName }) =>
      humanRequestedOwnerEmail({
        business_name: businessName,
        lead_phone: phoneDisplay,
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
  /** אופציה 2: סיכום חימום שנבנה ב-webhook לפני ההתראה; ריק → fallback לשחזור מ-DB */
  warmupSummaryPrecomputed?: string | null;
}): Promise<void> {
  const directRegistration = input.scheduleDirectRegistration !== false;
  const phoneDisplay = formatLeadPhoneDisplay(input.leadPhone);
  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  const serviceName =
    slug && sessionId
      ? await resolveServiceNameForSession({
          businessSlug: slug,
          sessionId,
          businessId: input.businessId,
        })
      : "";

  const serviceLabel = String(serviceName ?? "").trim() || "—";
  const schedule = formatScheduleLine({
    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
    scheduleDirectRegistration: input.scheduleDirectRegistration,
  });
  const registeredAt = formatRegisteredAtHe(input.registeredAtIso ?? new Date().toISOString());

  const warmupSummaries =
    !directRegistration && slug && sessionId
      ? await resolveWarmupSummaryForLeadRegistered({
          businessSlug: slug,
          sessionId,
          warmupSummaryPrecomputed: input.warmupSummaryPrecomputed,
        })
      : { email: "", wa: "" };

  await sendIfEnabled({
    businessId: input.businessId,
    key: "lead_registered",
    templateName: directRegistration ? "lead_registered" : "lead_registered_with_time",
    components: directRegistration
      ? buildLeadRegisteredWaParams(phoneDisplay)
      : buildLeadRegisteredWithTimeWaParams({
          leadPhoneDisplay: phoneDisplay,
          serviceName: serviceLabel,
          schedule,
          registeredAtHe: registeredAt,
          warmupSummary: warmupSummaries.wa,
        }),
  });

  await sendOwnerEmailIfEnabled({
    businessId: input.businessId,
    settingKey: "lead_registered_email",
    build: ({ businessName }) =>
      leadRegisteredOwnerEmail({
        business_name: businessName,
        lead_phone: phoneDisplay,
        service_name: serviceLabel,
        schedule,
        registered_at: registeredAt,
        warmup_session:
          warmupSummaries.email && warmupSummaries.email !== "—"
            ? warmupSummaries.email
            : undefined,
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

  const result = await sendOwnerWaMirrored({
    businessId: input.businessId,
    ownerPhone: gate.ownerPhone,
    templateName: "bot_paused_waiting",
    components: buildSinglePhoneWaParams(formatLeadPhoneDisplay(input.leadPhone)),
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

  const result = await sendOwnerWaMirrored({
    businessId: input.businessId,
    ownerPhone: gate.ownerPhone,
    templateName: "lead_cta_no_signup",
    components: buildSinglePhoneWaParams(formatLeadPhoneDisplay(input.leadPhone)),
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
  periodStartIso: string;
  periodEndIso: string;
  idleWindowMs: number;
}): Promise<void> {
  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const businessId = input.businessId;

  const [conversationsHeld, registeredLeads, notRelevantLeads, idleLeads] = await Promise.all([
    fetchConversationsHeldYesterday({
      businessId,
      periodStartIso: input.periodStartIso,
      periodEndIso: input.periodEndIso,
    }),
    fetchRegisteredYesterdayLeads({
      businessId,
      periodStartIso: input.periodStartIso,
      periodEndIso: input.periodEndIso,
    }),
    fetchNotRelevantYesterdayLeads({
      businessId,
      periodStartIso: input.periodStartIso,
      periodEndIso: input.periodEndIso,
    }),
    fetchIdleLeadsInWindow(businessId, input.idleWindowMs),
  ]);

  const registeredLine = formatDailySummaryLeadListForWa(registeredLeads);
  const notRelevantLine = formatDailySummaryNotRelevantLeadListForWa(notRelevantLeads);
  const noResponseLine = formatDailySummaryLeadListForWa(idleLeads);
  const dashboardUrl = dailySummaryDashboardUrl(slug);

  await sendIfEnabled({
    businessId,
    key: "daily_summary",
    templateName: DAILY_SUMMARY_WA_TEMPLATE_NAME,
    components: buildDailySummaryWaParams({
      dateLabel: input.dateLabel,
      conversationsHeld,
      registeredLine,
      notRelevantLine,
      noResponseLine,
      dashboardUrl,
    }),
  });

  await sendOwnerEmailIfEnabled({
    businessId,
    settingKey: "daily_summary_email",
    build: ({ businessName }) =>
      dailySummaryOwnerEmail({
        business_name: businessName,
        business_slug: slug,
        date_label: input.dateLabel,
        conversations_held: conversationsHeld,
        registered_leads: registeredLeads,
        not_relevant_leads: notRelevantLeads,
        no_response_leads: idleLeads,
        dashboard_url: dashboardUrl,
        no_response_window_hours: input.idleWindowMs >= 48 * 60 * 60 * 1000 ? 48 : 24,
      }),
  });

  const { touchNotificationSettingsDailySummaryAt } = await import(
    "@/lib/notifications/getNotificationSettings"
  );
  await touchNotificationSettingsDailySummaryAt(input.businessId);
}
