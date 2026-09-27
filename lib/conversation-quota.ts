import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { formatIsraelYearMonth } from "@/lib/israel-time";
import { isBusinessEligibleForOwnerNotifications } from "@/lib/notifications/business-notification-eligibility";
import {
  sendEmail,
  starterQuota100Email,
  starterQuota80Email,
  starterQuota95Email,
  starterQuotaOpsEmail,
  proQuota450OpsEmail,
} from "@/lib/email";
import { sendOwnerNotification } from "@/lib/notifications/sendOwnerNotification";
import { normalizePhone } from "@/lib/phone-normalize";
import { resolveStarterQuotaWaTemplate } from "@/lib/quota-alert-template";
import { loadMonthlyOpenedQuota } from "@/lib/zoe-opened-conversations";

export const STARTER_MONTHLY_CONTACT_LIMIT = 100;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export function planIsStarter(plan: unknown): boolean {
  const p = String(plan ?? "").trim().toLowerCase();
  return p !== "premium" && p !== "pro" && p !== "intro";
}

export function planIsPremium(plan: unknown): boolean {
  const p = String(plan ?? "").trim().toLowerCase();
  return p === "premium" || p === "pro" || p === "intro";
}

function resolveBillingUrl(siteBase: string, slug: string): string {
  const cleanSlug = String(slug ?? "").trim().toLowerCase();
  const base = siteBase.replace(/\/$/, "");
  if (!cleanSlug) return `${base}/account/billing`;
  return `${base}/${encodeURIComponent(cleanSlug)}/account/billing`;
}

type BizQuotaRow = {
  id?: unknown;
  plan?: unknown;
  email?: unknown;
  name?: unknown;
  slug?: unknown;
  social_links?: unknown;
  owner_whatsapp_phone?: unknown;
  owner_whatsapp_opted_in?: unknown;
  quota_warning_20_sent_at?: unknown;
  quota_warning_5_sent_at?: unknown;
  quota_limit_sent_at?: unknown;
  quota_pro_warning_sent_at?: unknown;
  is_active?: unknown;
  cancellation_effective_at?: unknown;
};

type StarterQuotaWaTemplate =
  | "quota_warning_80"
  | "quota_warning_80_util"
  | "quota_warning_95"
  | "quota_limit_reached"
  | "quota_limit_reached_util";

function resolveOpsAlertEmail(): string {
  return (process.env.SUBSCRIPTION_OPS_ALERT_EMAIL?.trim() || "liornativ@hotmail.com").toLowerCase();
}

function resolveOpsAlertWhatsApp(): string | null {
  return normalizePhone(process.env.OWNER_NOTIFICATION_MONITOR_WHATSAPP ?? "0508318162");
}

async function notifyStarterQuotaOps(input: {
  businessName: string;
  businessSlug: string;
  monthlyCount: number;
  threshold: 80 | 95 | 100;
  waTemplate: StarterQuotaWaTemplate;
  ownerEmail: string;
  ownerPhone: string;
}): Promise<boolean> {
  let ok = false;
  const opsEmail = resolveOpsAlertEmail();
  if (opsEmail && opsEmail !== input.ownerEmail) {
    const tpl = starterQuotaOpsEmail(
      input.businessName,
      input.businessSlug,
      input.monthlyCount,
      input.threshold
    );
    const r = await sendEmail({ to: opsEmail, subject: tpl.subject, htmlContent: tpl.htmlContent });
    if (r.ok) {
      ok = true;
      console.info("[conversation-quota] sent starter ops email:", input.threshold, input.businessSlug);
    } else {
      console.warn("[conversation-quota] starter ops email failed:", input.threshold, r.error);
    }
  }

  const opsWa = resolveOpsAlertWhatsApp();
  const ownerWa = normalizePhone(input.ownerPhone) ?? String(input.ownerPhone ?? "").replace(/\D/g, "");
  if (opsWa && opsWa !== ownerWa) {
    const r = await sendOwnerNotification({
      ownerPhone: opsWa,
      templateName: input.waTemplate,
      components: [],
    });
    if (r.ok) {
      ok = true;
      console.info("[conversation-quota] sent starter ops WA:", input.waTemplate, input.businessSlug);
    } else {
      console.warn("[conversation-quota] starter ops WA failed:", input.waTemplate, r.error);
    }
  }

  return ok;
}

async function sendStarterQuotaOwnerWhatsApp(
  bizRow: BizQuotaRow,
  templateName: StarterQuotaWaTemplate
): Promise<boolean> {
  if (!isBusinessEligibleForOwnerNotifications(bizRow)) return false;
  if (bizRow.owner_whatsapp_opted_in !== true) return false;
  const ownerPhone = String(bizRow.owner_whatsapp_phone ?? "").trim();
  if (!ownerPhone) return false;

  const result = await sendOwnerNotification({
    ownerPhone,
    templateName,
    components: [],
  });
  if (result.ok) {
    console.info("[conversation-quota] sent starter quota owner WA:", templateName);
    return true;
  }
  console.warn("[conversation-quota] starter quota owner WA failed:", templateName, result.error);
  return false;
}

async function markQuotaWarningSent(
  admin: AdminClient,
  bizId: unknown,
  column: "quota_warning_20_sent_at" | "quota_warning_5_sent_at" | "quota_limit_sent_at"
): Promise<void> {
  await admin
    .from("businesses")
    .update({ [column]: new Date().toISOString() } as Record<string, string>)
    .eq("id", bizId);
}

/**
 * שיחה חדשה נחסמת רק כשהמכסה כבר מלאה.
 * מספר שזואי כבר דיברה איתו החודש ממשיך — הוא לא פותח שיחה נוספת.
 */
export function starterQuotaShouldBlock(input: {
  alreadyCounted: boolean;
  monthlyCount: number;
  limit?: number;
}): boolean {
  if (input.alreadyCounted) return false;
  const limit = input.limit ?? STARTER_MONTHLY_CONTACT_LIMIT;
  return input.monthlyCount >= limit;
}

export type MonthlyQuotaHandleInput = {
  admin: AdminClient;
  businessSlug: string;
  businessId: string;
  bizRow: BizQuotaRow | null;
  contactId: number | string | null;
  phone: string;
};

export type MonthlyQuotaResult = { action: "continue" } | { action: "silent_stop" };

/**
 * Starter: חסימה כשמספר חדש היה פותח שיחה מעבר למכסה.
 * נספרים רק מספרים שזואי דיברה איתם החודש (לא איש קשר שנוצר בלי מענה).
 * מעל המכסה זואי לא עונה, בלי הודעה ללקוח.
 * Starter + Pro: מיילי התראה לבעלים (ב-Pro רק פנימי ב-450) לפי אותה ספירה.
 * IO לפנייה: COUNT ממוקד + קריאת שורה. בלי קריאות Claude/Meta נוספות. מעל המכסה אין קריאה ל-Claude.
 */
export async function handleMonthlyConversationQuota(params: MonthlyQuotaHandleInput): Promise<MonthlyQuotaResult> {
  const { admin, businessSlug, businessId, bizRow, contactId, phone } = params;

  if (!bizRow || !businessId || !contactId) {
    return { action: "continue" };
  }

  const siteBase = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://heyzoe.io";
  const billingSlug = String(bizRow.slug ?? businessSlug ?? "").trim().toLowerCase();
  const billingUrl = resolveBillingUrl(siteBase, billingSlug);
  const businessName = String(bizRow.name ?? "").trim();
  const displayName = businessName || businessSlug || "שם";
  const bizEmail = String(bizRow.email ?? "").trim().toLowerCase();

  const ymNow = formatIsraelYearMonth(new Date());
  const businessIdNum = Number(businessId);
  if (!Number.isFinite(businessIdNum)) {
    console.error("[conversation-quota] bad business id — not blocking", { businessSlug });
    return { action: "continue" };
  }

  const opened = await loadMonthlyOpenedQuota({
    admin,
    businessId: businessIdNum,
    businessSlug,
    contactId,
    phone,
  });
  if (!opened) {
    console.error("[conversation-quota] opened-conversation count unavailable — not blocking", {
      businessSlug,
    });
    return { action: "continue" };
  }

  const monthlyCount = opened.count;
  const starter = planIsStarter(bizRow.plan);
  const premium = planIsPremium(bizRow.plan);
  const cid = String(contactId);

  console.info("[conversation-quota]", {
    businessSlug,
    monthlyCount,
    alreadyCounted: opened.alreadyCounted,
    starter,
    premium,
    ymNow,
    phone_tail: phone.slice(-4),
  });

  if (starter && starterQuotaShouldBlock({ alreadyCounted: opened.alreadyCounted, monthlyCount })) {
    console.warn("[conversation-quota] starter monthly cap — no customer reply", { monthlyCount, cid });
    return { action: "silent_stop" };
  }

  const ownerNotificationsEligible = isBusinessEligibleForOwnerNotifications(bizRow);

  if (starter) {
    const ownerPhone = String(bizRow.owner_whatsapp_phone ?? "").trim();
    const opsBase = {
      businessName: displayName,
      businessSlug: billingSlug,
      monthlyCount,
      ownerEmail: bizEmail,
      ownerPhone,
    };
    try {
      if (monthlyCount >= 80 && !bizRow.quota_warning_20_sent_at) {
        let sent = false;
        if (ownerNotificationsEligible && bizEmail) {
          const tpl = starterQuota80Email(displayName, billingUrl);
          const r = await sendEmail({ to: bizEmail, subject: tpl.subject, htmlContent: tpl.htmlContent });
          if (r.ok) {
            sent = true;
            console.info("[conversation-quota] sent starter 80-email");
          }
        }
        const waTemplate = await resolveStarterQuotaWaTemplate(admin, "quota_warning_80");
        if (await sendStarterQuotaOwnerWhatsApp(bizRow, waTemplate)) sent = true;
        if (
          await notifyStarterQuotaOps({
            ...opsBase,
            threshold: 80,
            waTemplate,
          })
        ) {
          sent = true;
        }
        if (sent) await markQuotaWarningSent(admin, bizRow.id, "quota_warning_20_sent_at");
      }
      if (monthlyCount >= 95 && !bizRow.quota_warning_5_sent_at) {
        let sent = false;
        if (ownerNotificationsEligible && bizEmail) {
          const tpl = starterQuota95Email(displayName, billingUrl);
          const r = await sendEmail({ to: bizEmail, subject: tpl.subject, htmlContent: tpl.htmlContent });
          if (r.ok) {
            sent = true;
            console.info("[conversation-quota] sent starter 95-email");
          }
        }
        if (await sendStarterQuotaOwnerWhatsApp(bizRow, "quota_warning_95")) sent = true;
        if (
          await notifyStarterQuotaOps({ ...opsBase, threshold: 95, waTemplate: "quota_warning_95" })
        ) {
          sent = true;
        }
        if (sent) await markQuotaWarningSent(admin, bizRow.id, "quota_warning_5_sent_at");
      }
      if (monthlyCount >= 100 && !bizRow.quota_limit_sent_at) {
        let sent = false;
        if (ownerNotificationsEligible && bizEmail) {
          const tpl = starterQuota100Email(displayName, billingUrl);
          const r = await sendEmail({ to: bizEmail, subject: tpl.subject, htmlContent: tpl.htmlContent });
          if (r.ok) {
            sent = true;
            console.info("[conversation-quota] sent starter limit-email");
          }
        }
        const waTemplate = await resolveStarterQuotaWaTemplate(admin, "quota_limit_reached");
        if (await sendStarterQuotaOwnerWhatsApp(bizRow, waTemplate)) sent = true;
        if (
          await notifyStarterQuotaOps({
            ...opsBase,
            threshold: 100,
            waTemplate,
          })
        ) {
          sent = true;
        }
        if (sent) await markQuotaWarningSent(admin, bizRow.id, "quota_limit_sent_at");
      }
    } catch (e) {
      console.error("[conversation-quota] starter quota notifications failed:", e);
    }
  }

  if (premium && monthlyCount >= 450 && !bizRow.quota_pro_warning_sent_at) {
    try {
      const slug = String(bizRow.slug ?? businessSlug ?? "").trim().toLowerCase();
      const tpl = proQuota450OpsEmail(businessName || slug, slug, monthlyCount);
      const r = await sendEmail({ to: "liornativ@hotmail.com", subject: tpl.subject, htmlContent: tpl.htmlContent });
      if (r.ok) {
        await admin.from("businesses").update({ quota_pro_warning_sent_at: new Date().toISOString() } as any).eq("id", bizRow.id);
        console.info("[conversation-quota] sent pro-450 ops email");
      }
    } catch (e) {
      console.error("[conversation-quota] pro ops email failed:", e);
    }
  }

  return { action: "continue" };
}
