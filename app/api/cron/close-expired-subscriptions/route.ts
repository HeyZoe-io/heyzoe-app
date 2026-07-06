import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import {
  adminPlainAlertEmail,
  adminWhatsAppManagerDisconnectReminderEmail,
  subscriptionAccessEndedEmail,
  sendEmail,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TWILIO_OPS_EMAIL = "liornativ@hotmail.com";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/close-expired-subscriptions] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function opsAlertEmail(): string {
  return process.env.SUBSCRIPTION_OPS_ALERT_EMAIL?.trim() || TWILIO_OPS_EMAIL;
}

function formatTwilioDeletePhone(channel: {
  phone_display?: string | null;
  phone_number_id?: string | null;
  twilio_sid?: string | null;
}): string {
  const display = String(channel.phone_display ?? "").trim();
  if (display) return display;
  const sid = String(channel.twilio_sid ?? "").trim();
  if (sid) return `Twilio SID: ${sid}`;
  const metaId = String(channel.phone_number_id ?? "").trim();
  return metaId || "—";
}

/**
 * סגירת גישה לעסקים שתוקף הביטול נגמר — ללא קריאות ל-iCount.
 * Scheduling: external cron-job.org (not Vercel crons).
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/close-expired-subscriptions] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await admin
    .from("businesses")
    .select("id, slug, name, email, waba_id, cancellation_effective_at, is_active")
    .lte("cancellation_effective_at", nowIso)
    .not("cancellation_effective_at", "is", null)
    .eq("is_active", true)
    .limit(500);

  if (error) {
    console.error("[cron/close-expired-subscriptions] query failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = (rows ?? []) as any[];
  console.info("[cron/close-expired-subscriptions] candidates", { count: list.length, now: nowIso });

  const opsTo = opsAlertEmail();
  const results: Array<{ id: number; slug: string; ok: boolean }> = [];

  for (const b of list) {
    const id = Number(b.id);
    const slug = String(b.slug ?? "").trim().toLowerCase();
    const name = String(b.name ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();

    console.info("[cron/close-expired-subscriptions] processing", { id, slug, name });

    const { data: channels } = await admin
      .from("whatsapp_channels")
      .select("id, phone_display, phone_number_id, twilio_sid, is_active")
      .eq("business_id", id);

    const { data: closedRow, error: upErr } = await admin
      .from("businesses")
      .update({ is_active: false } as any)
      .eq("id", id)
      .eq("is_active", true)
      .select("id")
      .maybeSingle();

    if (upErr) {
      console.error("[cron/close-expired-subscriptions] is_active update failed:", { id, slug, err: upErr });
      results.push({ id, slug, ok: false });
      continue;
    }
    if (!closedRow) {
      console.info("[cron/close-expired-subscriptions] skip — already closed (concurrent run?)", { id, slug });
      continue;
    }
    console.info("[cron/close-expired-subscriptions] set is_active=false", { id, slug });

    const { error: chErr } = await admin
      .from("whatsapp_channels")
      .update({ is_active: false } as any)
      .eq("business_id", id);

    if (chErr) {
      console.error("[cron/close-expired-subscriptions] whatsapp_channels deactivate failed:", {
        id,
        slug,
        err: chErr,
      });
    } else {
      const deactivated = (channels ?? []).length;
      console.info("[cron/close-expired-subscriptions] whatsapp_channels is_active=false", { id, slug, deactivated });
    }

    if (email) {
      try {
        const displayName = name || email.split("@")[0] || "שם";
        const tpl = subscriptionAccessEndedEmail(displayName);
        const r = await sendEmail({ to: email, subject: tpl.subject, htmlContent: tpl.htmlContent });
        console.info("[cron/close-expired-subscriptions] customer email", { email, ok: r.ok });
      } catch (e) {
        console.error("[cron/close-expired-subscriptions] customer email exception:", e);
      }
    } else {
      console.warn("[cron/close-expired-subscriptions] no business email — skip customer mail", { slug });
    }

    try {
      const tpl = adminPlainAlertEmail(`HeyZoe — סגירת גישה (${name || slug})`, [
        `לקוח ${name || "—"} (${slug || "—"}) — גישה נסגרה היום.`,
        `business_id: ${id}`,
      ]);
      await sendEmail({ to: opsTo, subject: tpl.subject, htmlContent: tpl.htmlContent });
      console.info("[cron/close-expired-subscriptions] ops email sent", { opsTo, slug });
    } catch (e) {
      console.error("[cron/close-expired-subscriptions] ops email failed:", e);
    }

    try {
      const wabaId = String(b.waba_id ?? "").trim();
      const waTpl = adminWhatsAppManagerDisconnectReminderEmail(name, slug, wabaId || undefined);
      const waRes = await sendEmail({
        to: TWILIO_OPS_EMAIL,
        subject: waTpl.subject,
        htmlContent: waTpl.htmlContent,
      });
      console.info("[cron/close-expired-subscriptions] whatsapp manager disconnect reminder", {
        to: TWILIO_OPS_EMAIL,
        slug,
        ok: waRes.ok,
      });
      if (!waRes.ok) {
        console.error("[cron/close-expired-subscriptions] whatsapp manager reminder failed:", waRes.error);
      }
    } catch (e) {
      console.error("[cron/close-expired-subscriptions] whatsapp manager reminder exception:", e);
    }

    const channelList = (channels ?? []) as Array<{
      phone_display?: string | null;
      phone_number_id?: string | null;
      twilio_sid?: string | null;
    }>;
    if (channelList.length) {
      try {
        const phoneLines = channelList.map((ch) => `• ${formatTwilioDeletePhone(ch)}`);
        const tpl = adminPlainAlertEmail(`HeyZoe — מחק מטוויליו (${name || slug})`, [
          `עסק: ${name || "—"} (${slug || "—"})`,
          `business_id: ${id}`,
          "",
          "מספרי טלפון למחיקה מטוויליו:",
          ...phoneLines,
        ]);
        const r = await sendEmail({
          to: TWILIO_OPS_EMAIL,
          subject: tpl.subject,
          htmlContent: tpl.htmlContent,
        });
        console.info("[cron/close-expired-subscriptions] twilio delete email", {
          to: TWILIO_OPS_EMAIL,
          slug,
          ok: r.ok,
        });
      } catch (e) {
        console.error("[cron/close-expired-subscriptions] twilio delete email failed:", e);
      }
    }

    results.push({ id, slug, ok: true });
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
