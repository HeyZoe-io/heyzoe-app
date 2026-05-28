import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { sendEmail } from "@/lib/email";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET פעם ביום ב-08:00 ישראל + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 5000;
/** חלון 24 שעות אחורה (תואם לניסוח «ביממה האחרונה» במייל). */
const NO_RESPONSE_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

type NoResponseLead = {
  id: string | number;
  business_id: number;
  full_name: string | null;
  phone: string | null;
};

type LeadForEmail = {
  id: string | number;
  full_name: string | null;
  phone: string | null;
};

type BusinessRow = {
  id: number;
  slug: string | null;
  name: string | null;
  email: string | null;
  user_id: string | null;
};

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/daily-no-response-email] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function esc(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function leadName(lead: LeadForEmail): string {
  return String(lead.full_name ?? "").trim() || "ליד";
}

function leadPhone(lead: LeadForEmail): string {
  return String(lead.phone ?? "").trim() || "—";
}

function buildEmailHtml(input: {
  businessName: string;
  slug: string;
  leads: NoResponseLead[];
}): string {
  const listUrl = `https://heyzoe.io/${encodeURIComponent(input.slug)}/contacts?status=no_response`;
  const rows = input.leads
    .map(
      (lead) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right">${esc(leadName(lead))}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right" dir="ltr">${esc(leadPhone(lead))}</td>
        </tr>`
    )
    .join("");

  return [
    `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7;text-align:right;color:#18181b">`,
    `<p>היי ${esc(input.businessName)},</p>`,
    `<p>ביממה האחרונה יש ${input.leads.length} לידים שסיימו את כל 3 הפולואפים של זואי<br/>ועדיין לא ענו. הם לא אבודים, רק צריכים טאץ׳ אנושי 📞</p>`,
    `<p>הלידים שממתינים לשיחה:</p>`,
    `<table dir="rtl" style="border-collapse:collapse;width:100%;max-width:620px;margin:12px 0;text-align:right">`,
    `<thead><tr><th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right">שם</th><th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right">טלפון</th></tr></thead>`,
    `<tbody>${rows}</tbody>`,
    `</table>`,
    `<p>לצפייה ברשימה המלאה ולייצוא:<br/>👉 <a href="${esc(listUrl)}" style="color:#7133da;font-weight:700">לחץ כאן</a> → ${esc(listUrl)}</p>`,
    `<p>זואי עשתה את שלה, עכשיו התור שלך 🙂</p>`,
    `</div>`,
  ].join("");
}

function buildAllClearEmailHtml(input: { businessName: string }): string {
  return [
    `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7;text-align:right;color:#18181b">`,
    `<p>היי ${esc(input.businessName)},</p>`,
    `<p>רק רצינו לעדכן שאין לידים שממתינים לשיחה מ-24 השעות האחרונות.</p>`,
    `<p>זואי דיברה עם מי שצריך, שלחה פולואפים, ואין כרגע מה לטפל בו.</p>`,
    `<p>המשיכו כך 💜 צוות HeyZoe</p>`,
    `</div>`,
  ].join("");
}

function buildMarketingAdminEmailHtml(leads: LeadForEmail[]): string {
  const listUrl = "https://heyzoe.io/admin/leads";
  const rows = leads
    .map(
      (lead) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right">${esc(leadName(lead))}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right" dir="ltr">${esc(leadPhone(lead))}</td>
        </tr>`
    )
    .join("");

  return [
    `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7;text-align:right;color:#18181b">`,
    `<p>היי HeyZoe,</p>`,
    `<p>ביממה האחרונה יש ${leads.length} לידים שסיימו את כל 3 הפולואפים של זואי<br/>ועדיין לא ענו. הם לא אבודים, רק צריכים טאץ׳ אנושי 📞</p>`,
    `<p>הלידים שממתינים לשיחה:</p>`,
    `<table dir="rtl" style="border-collapse:collapse;width:100%;max-width:620px;margin:12px 0;text-align:right">`,
    `<thead><tr><th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right">שם</th><th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right">טלפון</th></tr></thead>`,
    `<tbody>${rows}</tbody>`,
    `</table>`,
    `<p>לצפייה ברשימה המלאה:<br/>👉 <a href="${esc(listUrl)}" style="color:#7133da;font-weight:700">לחץ כאן</a> → ${esc(listUrl)}</p>`,
    `<p>זואי עשתה את שלה, עכשיו התור שלך 🙂</p>`,
    `</div>`,
  ].join("");
}

async function loadOwnerEmailsByUserId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!ids.length) return map;

  const { data, error } = await admin.schema("auth").from("users").select("id, email").in("id", ids);
  if (error) {
    console.warn("[cron/daily-no-response-email] auth users lookup:", error.message);
    return map;
  }

  for (const row of data ?? []) {
    const id = String((row as { id?: string }).id ?? "").trim();
    const email = String((row as { email?: string }).email ?? "").trim().toLowerCase();
    if (id && email) map.set(id, email);
  }
  return map;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const sinceIso = new Date(Date.now() - NO_RESPONSE_EMAIL_WINDOW_MS).toISOString();

  const { data: channelRows, error: channelErr } = await admin
    .from("whatsapp_channels")
    .select("business_id")
    .eq("is_active", true)
    .limit(BATCH);
  if (channelErr) {
    console.error("[cron/daily-no-response-email] whatsapp_channels query:", channelErr);
    return NextResponse.json({ error: "channels_query_failed" }, { status: 500 });
  }
  const targetBusinessIds = Array.from(
    new Set(
      (channelRows ?? [])
        .map((r) => Number((r as { business_id?: unknown }).business_id))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  const { data: leadsData, error } = await admin
    .from("contacts")
    .select("id, business_id, full_name, phone")
    .eq("source", "whatsapp")
    .not("wa_no_response_at", "is", null)
    .gte("wa_no_response_at", sinceIso)
    .is("no_response_notified_at", null)
    .limit(BATCH);

  if (error) {
    if (/wa_no_response_at|no_response_notified_at|column/i.test(String(error.message ?? ""))) {
      return NextResponse.json({ ok: true, skipped: true, reason: "columns_missing" });
    }
    console.error("[cron/daily-no-response-email] contacts query:", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const leads = (leadsData ?? []) as NoResponseLead[];
  const byBusiness = new Map<number, NoResponseLead[]>();
  for (const lead of leads) {
    const businessId = Number(lead.business_id);
    if (!Number.isFinite(businessId) || businessId <= 0) continue;
    const group = byBusiness.get(businessId) ?? [];
    group.push(lead);
    byBusiness.set(businessId, group);
  }

  const businessIds = targetBusinessIds.length ? targetBusinessIds : [...byBusiness.keys()];
  const businesses = new Map<number, BusinessRow>();
  if (businessIds.length) {
    const { data: businessesData, error: bizErr } = await admin
      .from("businesses")
      .select("id, slug, name, email, user_id")
      .in("id", businessIds);

    if (bizErr) {
      console.error("[cron/daily-no-response-email] businesses query:", bizErr);
      return NextResponse.json({ error: "business_query_failed" }, { status: 500 });
    }

    for (const row of businessesData ?? []) {
      const biz = row as BusinessRow;
      const id = Number(biz.id);
      if (Number.isFinite(id)) businesses.set(id, biz);
    }
  }

  const authEmailByUserId = await loadOwnerEmailsByUserId(
    admin,
    [...businesses.values()].map((biz) => String(biz.user_id ?? ""))
  );

  let emailsSent = 0;
  let leadsNotified = 0;
  let skipped = 0;
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  for (const businessId of businessIds) {
    const group = byBusiness.get(businessId) ?? [];
    const biz = businesses.get(businessId);
    const slug = String(biz?.slug ?? "").trim().toLowerCase();
    const businessName = String(biz?.name ?? "").trim() || slug || "העסק שלך";
    const email =
      String(biz?.email ?? "").trim().toLowerCase() ||
      authEmailByUserId.get(String(biz?.user_id ?? "").trim()) ||
      "";

    if (!biz || !slug || !email) {
      skipped += 1;
      continue;
    }

    const result = group.length
      ? await sendEmail({
          to: email,
          subject: `🔔 ${group.length} לידים מחכים לשיחה ממך`,
          htmlContent: buildEmailHtml({ businessName, slug, leads: group }),
        })
      : await sendEmail({
          to: email,
          subject: "כל הלידים מטופלים - אין צורך בפעולה ✅",
          htmlContent: buildAllClearEmailHtml({ businessName }),
        });

    if (!result.ok) {
      errors.push(`${slug}: ${result.error}`);
      skipped += 1;
      continue;
    }

    const ids = group.map((lead) => lead.id).filter((id) => id != null);
    if (ids.length) {
      const { error: updateErr } = await admin
        .from("contacts")
        .update({ no_response_notified_at: nowIso })
        .in("id", ids);
      if (updateErr) {
        errors.push(`${slug}: update ${updateErr.message}`);
      } else {
        leadsNotified += ids.length;
      }
    }
    emailsSent += 1;
  }

  let marketingAdminEmailsSent = 0;
  let marketingAdminLeadsNotified = 0;
  const { data: marketingRows, error: marketingErr } = await admin
    .from("marketing_flow_sessions")
    .select("id, full_name, phone")
    .not("followup_3_sent_at", "is", null)
    .gte("followup_3_sent_at", sinceIso)
    .is("no_response_notified_at", null)
    .limit(BATCH);

  if (marketingErr) {
    if (/no_response_notified_at|column/i.test(String(marketingErr.message ?? ""))) {
      errors.push("heyzoe-marketing: no_response_notified_at column missing");
    } else {
      console.error("[cron/daily-no-response-email] marketing query:", marketingErr);
      errors.push(`heyzoe-marketing: ${marketingErr.message}`);
    }
  } else {
    const marketingLeads = (marketingRows ?? []) as LeadForEmail[];
    if (marketingLeads.length) {
      const result = await sendEmail({
        to: "office@heyzoe.io",
        subject: `🔔 ${marketingLeads.length} לידים מחכים לשיחה ממך`,
        htmlContent: buildMarketingAdminEmailHtml(marketingLeads),
      });

      if (!result.ok) {
        errors.push(`heyzoe-marketing: ${result.error}`);
        skipped += 1;
      } else {
        const ids = marketingLeads.map((lead) => lead.id).filter((id) => id != null);
        if (ids.length) {
          const { error: updateErr } = await admin
            .from("marketing_flow_sessions")
            .update({ no_response_notified_at: nowIso })
            .in("id", ids);
          if (updateErr) {
            errors.push(`heyzoe-marketing: update ${updateErr.message}`);
          } else {
            marketingAdminLeadsNotified = ids.length;
          }
        }
        marketingAdminEmailsSent = 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    businesses_examined: byBusiness.size,
    emails_sent: emailsSent,
    leads_notified: leadsNotified,
    marketing_admin_emails_sent: marketingAdminEmailsSent,
    marketing_admin_leads_notified: marketingAdminLeadsNotified,
    skipped,
    errors: errors.slice(0, 12),
  });
}
