import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { formatIsraelYearMonth, getIsraelMonthStartUtc } from "@/lib/israel-time";
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

function resolveBillingUrl(siteBase: string): string {
  return `${siteBase.replace(/\/$/, "")}/account/billing`;
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
};

async function sendStarterQuotaOwnerWhatsApp(
  bizRow: BizQuotaRow,
  templateName: "quota_warning_80" | "quota_warning_95" | "quota_limit_reached"
): Promise<boolean> {
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

async function fetchMonthlyContactRows(admin: AdminClient, businessId: string, monthStartIso: string) {
  const { data, error } = await admin
    .from("contacts")
    .select("id, created_at")
    .eq("business_id", businessId)
    .gte("created_at", monthStartIso)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(550);
  if (error) {
    console.warn("[conversation-quota] monthly contacts fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as { id: number | string; created_at: string }[];
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
  const billingUrl = resolveBillingUrl(siteBase);
  const businessName = String(bizRow.name ?? "").trim();
  const displayName = businessName || businessSlug || "שם";
  const bizEmail = String(bizRow.email ?? "").trim().toLowerCase();
  const customerPhone = extractCustomerServicePhone(bizRow.social_links);

  const monthStart = getIsraelMonthStartUtc();
  const monthStartIso = monthStart.toISOString();
  const ymNow = formatIsraelYearMonth(new Date());

  const monthlyRows = await fetchMonthlyContactRows(admin, businessId, monthStartIso);
  const monthlyCount = monthlyRows.length;

  const cid = String(contactId);
  const idx = monthlyRows.findIndex((r) => String(r.id) === cid);
  const rankInMonth = idx >= 0 ? idx + 1 : null;

  const starter = planIsStarter(bizRow.plan);
  const premium = planIsPremium(bizRow.plan);

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

  if (starter) {
    try {
      if (monthlyCount >= 80 && !bizRow.quota_warning_20_sent_at) {
        let sent = false;
        if (bizEmail) {
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
        if (bizEmail) {
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
        if (bizEmail) {
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
