import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { formatIsraelYearMonth, getIsraelMonthStartUtc } from "@/lib/israel-time";
import { isBusinessEligibleForOwnerNotifications } from "@/lib/notifications/business-notification-eligibility";
import {
  sendEmail,
  starterQuota100Email,
  starterQuota80Email,
  starterQuota95Email,
  proQuota450OpsEmail,
} from "@/lib/email";
import { sendOwnerNotification } from "@/lib/notifications/sendOwnerNotification";

export const STARTER_MONTHLY_CONTACT_LIMIT = 100;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export function planIsStarter(plan: unknown): boolean {
  const p = String(plan ?? "").trim().toLowerCase();
  return p !== "premium" && p !== "pro";
}

export function planIsPremium(plan: unknown): boolean {
  const p = String(plan ?? "").trim().toLowerCase();
  return p === "premium" || p === "pro";
}

function resolveBillingUrl(siteBase: string, slug: string): string {
  const cleanSlug = String(slug ?? "").trim().toLowerCase();
  const base = siteBase.replace(/\/$/, "");
  if (!cleanSlug) return `${base}/account/billing`;
  return `${base}/${encodeURIComponent(cleanSlug)}/account/billing`;
}

function extractCustomerServicePhone(socialLinks: unknown): string {
  if (!socialLinks || typeof socialLinks !== "object" || Array.isArray(socialLinks)) return "";
  const sl = socialLinks as Record<string, unknown>;
  return typeof sl.customer_service_phone === "string" ? sl.customer_service_phone.trim() : "";
}

export function buildStarterQuotaCapWhatsAppMessage(customerPhone: string): string {
  const lines = ["שלום! כרגע אין באפשרותנו לענות דרך הצ'אט."];
  const p = customerPhone.trim();
  if (p) lines.push(`לשירות ניתן ליצור קשר בטלפון: ${p}`);
  lines.push("נשמח לעזור 😊");
  return lines.join("\n");
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

async function sendStarterQuotaOwnerWhatsApp(
  bizRow: BizQuotaRow,
  templateName: "quota_warning_80" | "quota_warning_95" | "quota_limit_reached"
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

async function fetchMonthlyContactCount(
  admin: AdminClient,
  businessId: string,
  monthStartIso: string
): Promise<number> {
  const { count, error } = await admin
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gte("created_at", monthStartIso);
  if (error) {
    console.warn("[conversation-quota] monthly contacts count failed:", error.message);
    return 0;
  }
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

/** מיקום contact בחודש (1-based), לפי created_at ואז id — רק כשצריך חסימת Starter */
async function fetchContactRankInMonth(
  admin: AdminClient,
  businessId: string,
  contactId: string | number,
  monthStartIso: string
): Promise<number | null> {
  const { data: contact, error: contactErr } = await admin
    .from("contacts")
    .select("id, created_at")
    .eq("business_id", businessId)
    .eq("id", contactId)
    .maybeSingle();
  if (contactErr || !contact?.created_at) return null;

  const createdAt = String(contact.created_at);
  const id = contact.id;
  if (createdAt < monthStartIso) return null;

  const { count: strictlyBefore, error: beforeErr } = await admin
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gte("created_at", monthStartIso)
    .lt("created_at", createdAt);
  if (beforeErr) {
    console.warn("[conversation-quota] rank before-count failed:", beforeErr.message);
    return null;
  }

  const { count: sameTimestampNotAfter, error: sameErr } = await admin
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("created_at", createdAt)
    .lte("id", id);
  if (sameErr) {
    console.warn("[conversation-quota] rank same-ts count failed:", sameErr.message);
    return null;
  }

  return (strictlyBefore ?? 0) + (sameTimestampNotAfter ?? 0);
}

export type MonthlyQuotaHandleInput = {
  admin: AdminClient;
  businessSlug: string;
  businessId: string;
  bizRow: BizQuotaRow | null;
  contactId: number | string | null;
  starterQuotaNoticeMonth: string | null;
  phone: string;
};

export type MonthlyQuotaResult =
  | { action: "continue" }
  | { action: "silent_stop" }
  | { action: "starter_cap_message"; message: string; markMonth: string };

/**
 * Starter: חסימה כש-contact נוצר החודש והוא מעבר למכסה.
 * Starter + Pro: מיילי התראה (ב-Pro רק פנימי ב-450).
 */
export async function handleMonthlyConversationQuota(params: MonthlyQuotaHandleInput): Promise<MonthlyQuotaResult> {
  const { admin, businessSlug, businessId, bizRow, contactId, starterQuotaNoticeMonth, phone } = params;

  if (!bizRow || !businessId || !contactId) {
    return { action: "continue" };
  }

  const siteBase = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://heyzoe.io";
  const billingSlug = String(bizRow.slug ?? businessSlug ?? "").trim().toLowerCase();
  const billingUrl = resolveBillingUrl(siteBase, billingSlug);
  const businessName = String(bizRow.name ?? "").trim();
  const displayName = businessName || businessSlug || "שם";
  const bizEmail = String(bizRow.email ?? "").trim().toLowerCase();
  const customerPhone = extractCustomerServicePhone(bizRow.social_links);

  const monthStart = getIsraelMonthStartUtc();
  const monthStartIso = monthStart.toISOString();
  const ymNow = formatIsraelYearMonth(new Date());

  const monthlyCount = await fetchMonthlyContactCount(admin, businessId, monthStartIso);

  const starter = planIsStarter(bizRow.plan);
  const premium = planIsPremium(bizRow.plan);

  let rankInMonth: number | null = null;
  if (starter && monthlyCount > STARTER_MONTHLY_CONTACT_LIMIT) {
    rankInMonth = await fetchContactRankInMonth(admin, businessId, contactId, monthStartIso);
  }

  const cid = String(contactId);

  console.info("[conversation-quota]", {
    businessSlug,
    monthlyCount,
    rankInMonth,
    starter,
    premium,
    ymNow,
    phone_tail: phone.slice(-4),
  });

  if (starter && rankInMonth !== null && rankInMonth > STARTER_MONTHLY_CONTACT_LIMIT) {
    if (starterQuotaNoticeMonth === ymNow) {
      console.info("[conversation-quota] starter cap silence (already notified this IL month)", { cid });
      return { action: "silent_stop" };
    }
    const message = buildStarterQuotaCapWhatsAppMessage(customerPhone);
    console.warn("[conversation-quota] starter monthly cap exceeded — one notice", { rankInMonth, monthlyCount });
    return { action: "starter_cap_message", message, markMonth: ymNow };
  }

  const ownerNotificationsEligible = isBusinessEligibleForOwnerNotifications(bizRow);

  if (starter) {
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
        if (await sendStarterQuotaOwnerWhatsApp(bizRow, "quota_warning_80")) sent = true;
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
        if (await sendStarterQuotaOwnerWhatsApp(bizRow, "quota_limit_reached")) sent = true;
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
