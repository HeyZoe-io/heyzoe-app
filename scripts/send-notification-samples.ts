/**
 * שולח את כל תבניות המייל (Brevo) ותבניות WhatsApp לבעלים (Meta templates) לנמען בדיקה.
 *
 * הרצה:
 *   npx tsx --env-file=.env.local scripts/send-notification-samples.ts
 *
 * אופציונלי:
 *   TEST_EMAIL=you@example.com TEST_PHONE=9725XXXXXXXX npm run notifications:send-samples
 *   DRY_RUN=1 — רק מדפיס מה היה נשלח
 */

import {
  adminPlainAlertEmail,
  cancellationEmail,
  cancellationRequestReceivedEmail,
  dailySummaryOwnerEmail,
  humanRequestedOwnerEmail,
  leadRegisteredOwnerEmail,
  monthlyReportEmail,
  proQuota450OpsEmail,
  renewalReminderEmail,
  sendEmail,
  starterQuota100Email,
  starterQuota80Email,
  starterQuota95Email,
  subscriptionAccessEndedEmail,
  welcomeEmail,
  whatsappReadyEmail,
  type EmailTemplateResult,
} from "../lib/email";
import {
  dailySummaryDashboardUrl,
  formatDailySummaryLeadListForWa,
} from "../lib/notifications/daily-summary-data";
import {
  buildDailySummaryWaParams,
  DAILY_SUMMARY_WA_TEMPLATE_NAME,
  buildHumanAgentRequestWaParams,
  buildLeadRegisteredWaParams,
  buildLeadRegisteredWithTimeWaParams,
  buildNewLeadNotificationWaParams,
  buildSinglePhoneWaParams,
} from "../lib/notifications/owner-template-params";
import {
  sendOwnerNotification,
  type OwnerTemplateComponent,
} from "../lib/notifications/sendOwnerNotification";

const TEST_EMAIL = (process.env.TEST_EMAIL ?? "liornativ@hotmail.com").trim();
const TEST_PHONE_RAW = (process.env.TEST_PHONE ?? "0508318162").trim();
const DRY_RUN = process.env.DRY_RUN === "1";
/** רשימת מפתחות מופרדת בפסיק, למשל: human_agent,daily_summary */
const WA_FILTER = (process.env.WA_FILTER ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function normalizeIsraeliWhatsAppTo(to: string): string {
  const digits = String(to ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0") && digits.length >= 9) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `972${digits}`;
  return digits;
}

const TEST_PHONE = normalizeIsraeliWhatsAppTo(TEST_PHONE_RAW);

const SAMPLE = {
  businessName: "סטודיו בדיקה HeyZoe",
  businessSlug: "demo-studio",
  dashboardUrl: "https://heyzoe.io/demo-studio/dashboard",
  billingUrl: "https://heyzoe.io/demo-studio/billing",
  leadPhone: "0501234567",
  leadName: "ליד בדיקה",
  nowLabel: "04/06/2026 14:30",
  dateLabel: "03/06/2026",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendOneEmail(label: string, tpl: EmailTemplateResult): Promise<boolean> {
  const subject = `[TEST] ${tpl.subject}`;
  console.log(`\n📧 ${label}: ${tpl.subject}`);
  if (DRY_RUN) return true;
  const r = await sendEmail({ to: TEST_EMAIL, subject, htmlContent: tpl.htmlContent });
  if (!r.ok) {
    console.error(`   ❌ ${r.error}`);
    return false;
  }
  console.log("   ✅ נשלח");
  await sleep(1200);
  return true;
}

async function sendOneWa(
  label: string,
  templateName: string,
  components?: Parameters<typeof sendOwnerNotification>[0]["components"]
): Promise<boolean> {
  console.log(`\n📱 ${label}: ${templateName}`);
  if (DRY_RUN) return true;
  const r = await sendOwnerNotification({
    ownerPhone: TEST_PHONE,
    templateName,
    languageCode: "he",
    components,
  });
  if (!r.ok) {
    console.error(`   ❌ ${r.error}`);
    return false;
  }
  console.log("   ✅ נשלח");
  await sleep(1500);
  return true;
}

async function main() {
  console.log("=== HeyZoe notification samples ===");
  console.log("Email:", TEST_EMAIL);
  console.log("WhatsApp to:", TEST_PHONE, `(from ${TEST_PHONE_RAW})`);
  if (DRY_RUN) console.log("DRY_RUN=1 — לא נשלח בפועל");

  const hasBrevo = Boolean(process.env.BREVO_API_KEY?.trim());
  const hasMeta = Boolean(
    (process.env.META_ACCESS_TOKEN ?? process.env.WHATSAPP_SYSTEM_TOKEN ?? "").trim()
  );
  if (!DRY_RUN && !hasBrevo) {
    console.warn("⚠️ חסר BREVO_API_KEY — מדלג על מיילים (הוסף ל-.env.local או Vercel)");
  }
  if (!DRY_RUN && !hasMeta) {
    console.error("חסר META_ACCESS_TOKEN / WHATSAPP_SYSTEM_TOKEN ב-.env.local");
    process.exit(1);
  }

  let emailOk = 0;
  let emailFail = 0;
  let waOk = 0;
  let waFail = 0;

  const emails: Array<[string, EmailTemplateResult]> = [
    ["welcome", welcomeEmail(SAMPLE.businessName, SAMPLE.dashboardUrl)],
    ["whatsapp_ready", whatsappReadyEmail(SAMPLE.businessName, "050-0000000")],
    [
      "monthly_report",
      monthlyReportEmail(SAMPLE.businessName, "מאי 2026", 42, 30, 180, SAMPLE.dashboardUrl),
    ],
    [
      "renewal_reminder",
      renewalReminderEmail(SAMPLE.businessName, "15/06/2026", "299", SAMPLE.dashboardUrl),
    ],
    [
      "cancellation_request_received",
      cancellationRequestReceivedEmail(SAMPLE.businessName, "15/07/2026"),
    ],
    ["subscription_access_ended", subscriptionAccessEndedEmail(SAMPLE.businessName)],
    [
      "cancellation_soft",
      cancellationEmail(SAMPLE.businessName, "15/07/2026", SAMPLE.dashboardUrl),
    ],
    ["starter_quota_80", starterQuota80Email(SAMPLE.businessName, SAMPLE.billingUrl)],
    ["starter_quota_95", starterQuota95Email(SAMPLE.businessName, SAMPLE.billingUrl)],
    ["starter_quota_100", starterQuota100Email(SAMPLE.businessName, SAMPLE.billingUrl)],
    [
      "pro_quota_450_ops",
      proQuota450OpsEmail(SAMPLE.businessName, SAMPLE.businessSlug, 450),
    ],
    [
      "admin_plain_alert",
      adminPlainAlertEmail("התראת בדיקה", ["שורה 1", "שורה 2"]),
    ],
    [
      "lead_registered_owner",
      leadRegisteredOwnerEmail({
        business_name: SAMPLE.businessName,
        lead_phone: SAMPLE.leadPhone,
        service_name: "יוגה לנשים",
        schedule: "רביעי בשעה 18:00",
        registered_at: SAMPLE.nowLabel,
        warmup_session:
          "שאלה 1 מתוך סשן חימום (מה מביא אותך אלינו?)\n\nרוצה להתחזק",
      }),
    ],
    [
      "human_requested_owner",
      humanRequestedOwnerEmail({
        business_name: SAMPLE.businessName,
        lead_phone: SAMPLE.leadPhone,
        requested_at: SAMPLE.nowLabel,
      }),
    ],
    [
      "daily_summary_idle",
      dailySummaryOwnerEmail({
        business_name: SAMPLE.businessName,
        business_slug: SAMPLE.businessSlug,
        date_label: SAMPLE.dateLabel,
        conversations_held: 4,
        registered_leads: [
          { full_name: "ליאור", phone: "0508318162" },
          { full_name: "אופיר", phone: "0546758590" },
        ],
        no_response_leads: [
          { full_name: "איתי", phone: "0538475849" },
          { full_name: "שולמית", phone: "0547685940" },
        ],
        dashboard_url: dailySummaryDashboardUrl(SAMPLE.businessSlug),
      }),
    ],
    [
      "daily_summary_clear",
      dailySummaryOwnerEmail({
        business_name: SAMPLE.businessName,
        business_slug: SAMPLE.businessSlug,
        date_label: SAMPLE.dateLabel,
        conversations_held: 4,
        registered_leads: [
          { full_name: "ליאור", phone: "0508318162" },
        ],
        no_response_leads: [],
        dashboard_url: dailySummaryDashboardUrl(SAMPLE.businessSlug),
      }),
    ],
  ];

  if (hasBrevo || DRY_RUN) {
    console.log("\n--- מיילים ---");
    for (const [label, tpl] of emails) {
      if (await sendOneEmail(label, tpl)) emailOk++;
      else emailFail++;
    }
  }

  const waTemplates: Array<[string, string, OwnerTemplateComponent[] | undefined]> = [
    [
      "new_lead",
      "new_lead_notification",
      buildNewLeadNotificationWaParams({
        businessName: SAMPLE.businessName,
        leadPhoneDisplay: SAMPLE.leadPhone,
        atHe: "14:32",
      }),
    ],
    [
      "human_agent",
      "human_agent_request",
      buildHumanAgentRequestWaParams({
        leadPhoneDisplay: SAMPLE.leadPhone,
        requestedAtHe: SAMPLE.nowLabel,
      }),
    ],
    ["lead_registered", "lead_registered", buildLeadRegisteredWaParams(SAMPLE.leadPhone)],
    [
      "lead_registered_with_time",
      "lead_registered_with_time",
      buildLeadRegisteredWithTimeWaParams({
        leadPhoneDisplay: SAMPLE.leadPhone,
        serviceName: "יוגה לנשים",
        schedule: "רביעי בשעה 18:00",
        registeredAtHe: SAMPLE.nowLabel,
        warmupSummary:
          "שאלה 1 מתוך סשן חימום (מה מביא אותך אלינו?)\n\nרוצה להתחזק",
      }),
    ],
    ["bot_paused_waiting", "bot_paused_waiting", buildSinglePhoneWaParams(SAMPLE.leadPhone)],
    ["lead_cta_no_signup", "lead_cta_no_signup", buildSinglePhoneWaParams(SAMPLE.leadPhone)],
    [
      "daily_summary",
      DAILY_SUMMARY_WA_TEMPLATE_NAME,
      buildDailySummaryWaParams({
        dateLabel: SAMPLE.dateLabel,
        conversationsHeld: 4,
        registeredLine: formatDailySummaryLeadListForWa([
          { full_name: "ליאור", phone: "0508318162" },
          { full_name: "אופיר", phone: "0546758590" },
        ]),
        notRelevantCountLine: "1",
        noResponseLine: formatDailySummaryLeadListForWa([
          { full_name: "איתי", phone: "0538475849" },
          { full_name: "שולמית", phone: "0547685940" },
          ...Array.from({ length: 17 }, (_, i) => ({
            full_name: `ליד ${i + 3}`,
            phone: `0500000${String(i).padStart(3, "0")}`,
          })),
        ]),
        dashboardUrl: dailySummaryDashboardUrl(SAMPLE.businessSlug),
      }),
    ],
    ["quota_warning_80", "quota_warning_80", undefined],
    ["quota_warning_95", "quota_warning_95", undefined],
    ["quota_limit_reached", "quota_limit_reached", undefined],
    [
      "marketing_human_agent",
      "marketing_human_agent_request",
      buildSinglePhoneWaParams(SAMPLE.leadPhone),
    ],
  ];

  console.log("\n--- WhatsApp (תבניות Meta לבעלים) ---");
  for (const [label, name, components] of waTemplates) {
    if (WA_FILTER.length > 0 && !WA_FILTER.includes(label)) continue;
    if (await sendOneWa(label, name, components)) waOk++;
    else waFail++;
  }

  console.log("\n=== סיכום ===");
  console.log(`מיילים: ${emailOk} הצליחו, ${emailFail} נכשלו`);
  console.log(`WhatsApp: ${waOk} הצליחו, ${waFail} נכשלו`);
  if (emailFail > 0 || waFail > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
