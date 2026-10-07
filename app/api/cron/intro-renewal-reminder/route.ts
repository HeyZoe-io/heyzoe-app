import { NextRequest, NextResponse } from "next/server";
import { acknowledgeCron, rejectCronTimeOverride } from "@/lib/cron-clock";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { introRenewalOpsEmail, sendEmail } from "@/lib/email";
import { formatIsraelDate, INTRO_REMINDER_LATE_MS, INTRO_REMINDER_LEAD_MS, introReminderIsDue } from "@/lib/intro-offer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPS_EMAIL = "liornativ@hotmail.com";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/intro-renewal-reminder] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function opsAlertEmail(): string {
  return process.env.SUBSCRIPTION_OPS_ALERT_EMAIL?.trim() || OPS_EMAIL;
}

/**
 * מייל לאדמין 3 ימים לפני שחודש ה-₪5 נגמר.
 * Scheduling: external cron-job.org once a day (not Vercel crons).
 * GET /api/cron/intro-renewal-reminder  Authorization: Bearer CRON_SECRET
 *
 * IO: שאילתה אחת על אינדקס חלקי (רק עסקים שעדיין במבצע ולא נשלח להם מייל).
 * Brevo: מייל אחד לכל עסק, פעם אחת.
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/intro-renewal-reminder] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rejectedClock = rejectCronTimeOverride(req);
  if (rejectedClock) return rejectedClock;
  await acknowledgeCron(req, "/api/cron/intro-renewal-reminder");


  const admin = createSupabaseAdminClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + INTRO_REMINDER_LEAD_MS).toISOString();
  const windowStart = new Date(now.getTime() - INTRO_REMINDER_LATE_MS).toISOString();

  const { data: rows, error } = await admin
    .from("businesses")
    .select("id, slug, name, email, intro_period_ends_at, intro_reminder_sent_at, intro_full_price_at, is_active")
    .not("intro_period_ends_at", "is", null)
    .is("intro_reminder_sent_at", null)
    .is("intro_full_price_at", null)
    .eq("is_active", true)
    .lte("intro_period_ends_at", windowEnd)
    .gt("intro_period_ends_at", windowStart)
    .limit(50);

  if (error) {
    console.error("[cron/intro-renewal-reminder] query failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = (rows ?? []) as Array<{
    id: number;
    slug: string | null;
    name: string | null;
    email: string | null;
    intro_period_ends_at: string | null;
    intro_reminder_sent_at: string | null;
    intro_full_price_at: string | null;
  }>;

  const opsTo = opsAlertEmail();
  const results: Array<{ id: number; slug: string; ok: boolean; error?: string }> = [];

  for (const row of list) {
    if (
      !introReminderIsDue({
        introPeriodEndsAt: row.intro_period_ends_at,
        introReminderSentAt: row.intro_reminder_sent_at,
        introFullPriceAt: row.intro_full_price_at,
        now,
      })
    ) {
      continue;
    }

    const id = Number(row.id);
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("businesses")
      .update({ intro_reminder_sent_at: claimedAt })
      .eq("id", id)
      .is("intro_reminder_sent_at", null)
      .select("id")
      .maybeSingle();

    if (claimErr || !claimed) {
      console.error("[cron/intro-renewal-reminder] claim failed:", { id, error: claimErr?.message ?? "not_claimed" });
      results.push({ id, slug: String(row.slug ?? ""), ok: false, error: claimErr?.message ?? "not_claimed" });
      continue;
    }

    const slug = String(row.slug ?? "").trim();
    const tpl = introRenewalOpsEmail({
      businessName: String(row.name ?? "").trim() || slug,
      slug,
      customerEmail: String(row.email ?? "").trim(),
      endsAtLabel: formatIsraelDate(row.intro_period_ends_at),
      adminUrl: "https://heyzoe.io/admin/businesses",
    });
    const sent = await sendEmail({ to: opsTo, subject: tpl.subject, htmlContent: tpl.htmlContent });
    if (!sent.ok) {
      console.error("[cron/intro-renewal-reminder] email failed:", { id, slug, error: sent.error });
      const { error: revertErr } = await admin
        .from("businesses")
        .update({ intro_reminder_sent_at: null })
        .eq("id", id)
        .eq("intro_reminder_sent_at", claimedAt);
      if (revertErr) {
        console.error("[cron/intro-renewal-reminder] revert claim failed:", { id, error: revertErr.message });
      }
      results.push({ id, slug, ok: false, error: sent.error });
      continue;
    }

    results.push({ id, slug, ok: true });
  }

  console.info("[cron/intro-renewal-reminder] done", { checked: list.length, results });
  return NextResponse.json({ ok: true, checked: list.length, results });
}
