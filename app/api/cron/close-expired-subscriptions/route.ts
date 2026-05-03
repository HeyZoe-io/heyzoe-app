import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { adminPlainAlertEmail, subscriptionAccessEndedEmail, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return process.env.SUBSCRIPTION_OPS_ALERT_EMAIL?.trim() || "liornativ@hotmail.com";
}

/**
 * סגירת גישה לעסקים שתוקף הביטול נגמר — ללא קריאות ל-iCount.
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
    .select("id, slug, name, email, cancellation_effective_at, is_active")
    .lte("cancellation_effective_at", nowIso)
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

    const { error: upErr } = await admin.from("businesses").update({ is_active: false } as any).eq("id", id);

    if (upErr) {
      console.error("[cron/close-expired-subscriptions] is_active update failed:", { id, slug, err: upErr });
      results.push({ id, slug, ok: false });
      continue;
    }
    console.info("[cron/close-expired-subscriptions] set is_active=false", { id, slug });

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

    results.push({ id, slug, ok: true });
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
