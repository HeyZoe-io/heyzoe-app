import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { sendEmail } from "@/lib/email";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET פעם ביום ב-08:00 ישראל + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 5000;

type NoResponseLead = {
  id: string | number;
  business_id: number;
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

function leadName(lead: NoResponseLead): string {
  return String(lead.full_name ?? "").trim() || "ליד";
}

function leadPhone(lead: NoResponseLead): string {
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
  const { data: leadsData, error } = await admin
    .from("contacts")
    .select("id, business_id, full_name, phone")
    .eq("source", "whatsapp")
    .not("wa_no_response_at", "is", null)
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

  if (!byBusiness.size) {
    return NextResponse.json({ ok: true, businesses_examined: 0, emails_sent: 0, leads_notified: 0 });
  }

  const businessIds = [...byBusiness.keys()];
  const { data: businessesData, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, name, email, user_id")
    .in("id", businessIds);

  if (bizErr) {
    console.error("[cron/daily-no-response-email] businesses query:", bizErr);
    return NextResponse.json({ error: "business_query_failed" }, { status: 500 });
  }

  const businesses = new Map<number, BusinessRow>();
  for (const row of businessesData ?? []) {
    const biz = row as BusinessRow;
    const id = Number(biz.id);
    if (Number.isFinite(id)) businesses.set(id, biz);
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

  for (const [businessId, group] of byBusiness.entries()) {
    const biz = businesses.get(businessId);
    const slug = String(biz?.slug ?? "").trim().toLowerCase();
    const businessName = String(biz?.name ?? "").trim() || slug || "העסק שלך";
    const email =
      String(biz?.email ?? "").trim().toLowerCase() ||
      authEmailByUserId.get(String(biz?.user_id ?? "").trim()) ||
      "";

    if (!biz || !slug || !email || !group.length) {
      skipped += 1;
      continue;
    }

    const result = await sendEmail({
      to: email,
      subject: `🔔 ${group.length} לידים מחכים לשיחה ממך`,
      htmlContent: buildEmailHtml({ businessName, slug, leads: group }),
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

  return NextResponse.json({
    ok: true,
    businesses_examined: byBusiness.size,
    emails_sent: emailsSent,
    leads_notified: leadsNotified,
    skipped,
    errors: errors.slice(0, 12),
  });
}
