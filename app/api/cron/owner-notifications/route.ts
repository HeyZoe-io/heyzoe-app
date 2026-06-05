import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { HEYZOE_SF_REGISTERED } from "@/lib/analytics";
import { resolveCronSecret } from "@/lib/server-env";
import { getIsraelYesterdayRange } from "@/lib/israel-time";
import { getNotificationSettings } from "@/lib/notifications/getNotificationSettings";
import { triggerCtaNoSignupNotification, triggerDailySummaryNotification } from "@/lib/notifications/triggers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CTA_NO_SIGNUP_MS = 20 * 60 * 1000;
const AUTO_UNPAUSE_MS = 15 * 60 * 1000;

function israelNowParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour"), year: get("year"), month: get("month"), day: get("day") };
}

export async function GET(req: NextRequest) {
  const secret = resolveCronSecret();
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const qs = req.nextUrl.searchParams.get("secret") ?? "";
  if (secret && auth !== secret && qs !== secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.warn("[cron/owner-notifications] CRON_SECRET not set — allowing request in dev only");
  }

  const admin = createSupabaseAdminClient();
  const now = Date.now();
  let autoUnpaused = 0;
  let ctaSent = 0;
  let summariesSent = 0;

  // ── auto-unpause bot after 15 min (no owner WA notification) ─────────────
  const unpauseCutoff = new Date(now - AUTO_UNPAUSE_MS).toISOString();
  const { data: unpauseRows, error: unpauseErr } = await admin
    .from("conversations")
    .update({
      bot_paused: false,
      paused_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("bot_paused", true)
    .not("paused_at", "is", null)
    .lte("paused_at", unpauseCutoff)
    .select("id");

  if (unpauseErr) {
    console.warn("[cron/owner-notifications] auto-unpause failed:", unpauseErr.message);
  } else {
    autoUnpaused = unpauseRows?.length ?? 0;
  }

  // ── cta_no_signup (20 min, no "נרשמתי") ───────────────────────────────────
  const ctaCutoff = new Date(now - CTA_NO_SIGNUP_MS).toISOString();
  const { data: ctaRows } = await admin
    .from("conversations")
    .select("id, business_id, phone, session_id, cta_clicked_at")
    .not("cta_clicked_at", "is", null)
    .eq("cta_notification_sent", false)
    .lte("cta_clicked_at", ctaCutoff)
    .limit(200);

  for (const row of ctaRows ?? []) {
    const businessId = Number((row as { business_id?: number }).business_id);
    const sessionId = String((row as { session_id?: string }).session_id ?? "").trim();
    const phone = String((row as { phone?: string }).phone ?? "").trim();
    const id = String((row as { id?: string }).id ?? "");
    const ctaAt = String((row as { cta_clicked_at?: string }).cta_clicked_at ?? "");
    if (!businessId || !sessionId || !id || !ctaAt) continue;

    const { data: registeredEvent } = await admin
      .from("messages")
      .select("id")
      .eq("session_id", sessionId)
      .eq("role", "event")
      .eq("content", HEYZOE_SF_REGISTERED)
      .gte("created_at", ctaAt)
      .limit(1)
      .maybeSingle();

    if (registeredEvent) continue;

    const { data: contact } = await admin
      .from("contacts")
      .select("trial_registered")
      .eq("business_id", businessId)
      .eq("phone", phone)
      .maybeSingle();

    if ((contact as { trial_registered?: boolean } | null)?.trial_registered === true) continue;

    await triggerCtaNoSignupNotification({ businessId, conversationId: id, leadPhone: phone });
    ctaSent += 1;
  }

  // ── daily_summary (08:00 Israel) — WA + email per settings ────────────────
  const { hour } = israelNowParts();
  if (hour === 8) {
    const { start, end, label } = getIsraelYesterdayRange();
    const { data: businesses } = await admin
      .from("businesses")
      .select("id, slug, name, is_active, owner_whatsapp_opted_in, owner_whatsapp_phone, email")
      .eq("is_active", true);

    for (const biz of businesses ?? []) {
      const businessId = Number((biz as { id?: number }).id);
      const slug = String((biz as { slug?: string }).slug ?? "").trim().toLowerCase();
      if (!businessId || !slug) continue;

      const settings = await getNotificationSettings(businessId);
      const wantsWa =
        settings.daily_summary &&
        (biz as { owner_whatsapp_opted_in?: boolean }).owner_whatsapp_opted_in === true &&
        Boolean(String((biz as { owner_whatsapp_phone?: string }).owner_whatsapp_phone ?? "").trim());
      const wantsEmail = settings.daily_summary_email;
      if (!wantsWa && !wantsEmail) continue;

      const lastAt = await admin
        .from("notification_settings")
        .select("last_daily_summary_at")
        .eq("business_id", businessId)
        .maybeSingle();

      const lastSummary = (lastAt.data as { last_daily_summary_at?: string } | null)?.last_daily_summary_at;
      if (lastSummary) {
        const lastDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
          new Date(lastSummary)
        );
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
        if (lastDay === today) continue;
      }

      await triggerDailySummaryNotification({
        businessId,
        businessSlug: slug,
        dateLabel: label,
        periodStartIso: start,
        periodEndIso: end,
      });
      summariesSent += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    autoUnpaused,
    ctaSent,
    summariesSent,
    israelHour: hour,
  });
}
