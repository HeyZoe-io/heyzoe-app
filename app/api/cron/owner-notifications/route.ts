import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { HEYZOE_SF_REGISTERED } from "@/lib/analytics";
import { resolveCronSecret } from "@/lib/server-env";
import { getNotificationSettings } from "@/lib/notifications/getNotificationSettings";
import {
  triggerBotPausedWaitingNotification,
  triggerCtaNoSignupNotification,
  triggerDailySummaryNotification,
} from "@/lib/notifications/triggers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAUSED_WAIT_MS = 30 * 60 * 1000;
const CTA_NO_SIGNUP_MS = 20 * 60 * 1000;

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

function yesterdayIsraelRange(): { start: string; end: string; label: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" });
  const todayStr = fmt.format(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = fmt.format(yesterday);
  return {
    start: `${yStr}T00:00:00+02:00`,
    end: `${todayStr}T00:00:00+02:00`,
    label: new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "medium" }).format(yesterday),
  };
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
  let pausedSent = 0;
  let ctaSent = 0;
  let summariesSent = 0;

  // ── bot_paused_waiting (30 min) ─────────────────────────────────────────────
  const pausedCutoff = new Date(now - PAUSED_WAIT_MS).toISOString();
  const { data: pausedRows } = await admin
    .from("conversations")
    .select("id, business_id, phone, session_id")
    .eq("bot_paused", true)
    .eq("paused_notification_sent", false)
    .limit(200);

  for (const row of pausedRows ?? []) {
    const businessId = Number((row as { business_id?: number }).business_id);
    const sessionId = String((row as { session_id?: string }).session_id ?? "").trim();
    const phone = String((row as { phone?: string }).phone ?? "").trim();
    const id = String((row as { id?: string }).id ?? "");
    if (!businessId || !sessionId || !id) continue;

    const { data: biz } = await admin.from("businesses").select("slug").eq("id", businessId).maybeSingle();
    const slug = String((biz as { slug?: string } | null)?.slug ?? "").trim().toLowerCase();
    if (!slug) continue;

    const { data: lastMsg } = await admin
      .from("messages")
      .select("role, created_at")
      .eq("business_slug", slug)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const role = String((lastMsg as { role?: string } | null)?.role ?? "");
    const createdAt = String((lastMsg as { created_at?: string } | null)?.created_at ?? "");
    if (role !== "user" || !createdAt || createdAt > pausedCutoff) continue;

    await triggerBotPausedWaitingNotification({ businessId, conversationId: id, leadPhone: phone });
    pausedSent += 1;
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

  // ── daily_summary (08:00 Israel) ──────────────────────────────────────────
  const { hour } = israelNowParts();
  if (hour === 8) {
    const { start, end, label } = yesterdayIsraelRange();
    const { data: businesses } = await admin.from("businesses").select("id, slug, name, is_active").eq("is_active", true);

    for (const biz of businesses ?? []) {
      const businessId = Number((biz as { id?: number }).id);
      const slug = String((biz as { slug?: string }).slug ?? "").trim().toLowerCase();
      const name = String((biz as { name?: string }).name ?? "").trim();
      if (!businessId || !slug) continue;

      const settings = await getNotificationSettings(businessId);
      if (!settings.daily_summary) continue;

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

      const [{ count: newLeads }, { count: ctaReached }, { count: registered }] = await Promise.all([
        admin
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .gte("created_at", start)
          .lt("created_at", end),
        admin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("business_slug", slug)
          .eq("model_used", "sf_cta_reached")
          .gte("created_at", start)
          .lt("created_at", end),
        admin
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("trial_registered", true)
          .gte("trial_registered_at", start)
          .lt("trial_registered_at", end),
      ]);

      const { data: recentMsgs } = await admin
        .from("messages")
        .select("session_id, role, created_at")
        .eq("business_slug", slug)
        .gte("created_at", new Date(now - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(5000);

      const lastBySession = new Map<string, string>();
      for (const m of recentMsgs ?? []) {
        const sid = String((m as { session_id?: string }).session_id ?? "");
        if (!sid || lastBySession.has(sid)) continue;
        lastBySession.set(sid, String((m as { role?: string }).role ?? ""));
      }
      let openConversations = 0;
      for (const role of lastBySession.values()) {
        if (role === "user") openConversations += 1;
      }

      await triggerDailySummaryNotification({
        businessId,
        dateLabel: label,
        newLeads: newLeads ?? 0,
        openConversations,
        ctaReached: ctaReached ?? 0,
        registered: registered ?? 0,
      });
      summariesSent += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    pausedSent,
    ctaSent,
    summariesSent,
    israelHour: hour,
  });
}
