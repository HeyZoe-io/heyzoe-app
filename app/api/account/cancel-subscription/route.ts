import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { tryCancelStandingOrder } from "@/lib/icount-v3";
import {
  cancellationRequestReceivedEmail,
  adminPlainAlertEmail,
  formatDateDdMmYyyy,
  sendEmail,
} from "@/lib/email";

export const runtime = "nodejs";

function opsAlertEmail(): string {
  return process.env.SUBSCRIPTION_OPS_ALERT_EMAIL?.trim() || "liornativ@hotmail.com";
}

/**
 * ביטול מנוי (שלב 1): תאריכים ב-DB + ניסיון hk/cancel ב-iCount (לא חוסם) + מיילים.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: business } = await admin
    .from("businesses")
    .select(
      "id, user_id, slug, name, email, cancellation_requested_at, cancellation_effective_at, icount_client_id, icount_hk_cancelled"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) {
    return NextResponse.json({ error: "no_business" }, { status: 400 });
  }

  if (business.cancellation_requested_at) {
    return NextResponse.json({ error: "already_cancelled" }, { status: 400 });
  }

  const now = new Date();
  const effective = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const businessId = Number((business as any).id);
  const businessName = String((business as any)?.name ?? "").trim();
  const slug = String((business as any)?.slug ?? "").trim().toLowerCase();

  console.info("[api/account/cancel-subscription] start", {
    business_id: businessId,
    slug,
    user_id: user.id,
  });

  const { error: updateErr } = await admin
    .from("businesses")
    .update({
      cancellation_requested_at: now.toISOString(),
      cancellation_effective_at: effective.toISOString(),
    } as any)
    .eq("id", businessId)
    .eq("user_id", user.id);

  if (updateErr) {
    console.error("[api/account/cancel-subscription] update cancellation dates failed:", updateErr);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  console.info("[api/account/cancel-subscription] db: cancellation dates set", {
    effective_at: effective.toISOString(),
  });

  const opsTo = opsAlertEmail();
  const icountClientId = String((business as any)?.icount_client_id ?? "").trim();

  if (!icountClientId) {
    console.warn("[api/account/cancel-subscription] icount: skipped — missing icount_client_id on business row");
    try {
      const tpl = adminPlainAlertEmail(`HeyZoe — ביטול מנוי (${businessName || slug})`, [
      `לקוח ${businessName || slug} — חסר icount_client_id ב-DB; לא ניתן לחפש הוראת קבע ב-iCount.`,
      `business_id: ${businessId}`,
      `slug: ${slug || "—"}`,
      ]);
      await sendEmail({ to: opsTo, subject: tpl.subject, htmlContent: tpl.htmlContent });
    } catch (e) {
      console.error("[api/account/cancel-subscription] ops email (no client id) failed:", e);
    }
  } else {
    try {
      const outcome = await tryCancelStandingOrder(icountClientId);
      console.info("[api/account/cancel-subscription] icount outcome", { outcome });

      if (outcome.kind === "cancelled") {
        const { error: hkErr } = await admin
          .from("businesses")
          .update({ icount_hk_cancelled: true } as any)
          .eq("id", businessId)
          .eq("user_id", user.id);
        if (hkErr) {
          console.error("[api/account/cancel-subscription] failed to set icount_hk_cancelled:", hkErr);
        } else {
          console.info("[api/account/cancel-subscription] icount_hk_cancelled=true", { hk_id: outcome.hk_id });
        }
      } else if (outcome.kind === "no_hk_id") {
        try {
          const tpl = adminPlainAlertEmail(`HeyZoe — ביטול מנוי (${businessName || slug})`, [
            `לקוח ${businessName} — לא נמצאה הוראת קבע ב-iCount, יש לבדוק ידנית.`,
            `slug: ${slug || "—"}`,
            `client_id: ${icountClientId}`,
            `סיבה: ${outcome.reason}`,
          ]);
          await sendEmail({ to: opsTo, subject: tpl.subject, htmlContent: tpl.htmlContent });
        } catch (e) {
          console.error("[api/account/cancel-subscription] ops email (no hk) failed:", e);
        }
      } else if (outcome.kind === "api_error" || outcome.kind === "skipped_no_credentials") {
        try {
          const tpl = adminPlainAlertEmail(`HeyZoe — כשל iCount בביטול (${businessName || slug})`, [
            `לקוח ${businessName || slug} — כשל ב-iCount בשלב ${outcome.kind === "api_error" ? outcome.step : "login/credentials"}.`,
            outcome.detail ? `פרטים: ${outcome.detail}` : "",
            `client_id: ${icountClientId}`,
          ]);
          await sendEmail({ to: opsTo, subject: tpl.subject, htmlContent: tpl.htmlContent });
        } catch (e) {
          console.error("[api/account/cancel-subscription] ops email (api error) failed:", e);
        }
      }
    } catch (e) {
      console.error("[api/account/cancel-subscription] icount unexpected error:", e);
      try {
        const tpl = adminPlainAlertEmail(`HeyZoe — חריגה בביטול iCount (${businessName || slug})`, [
          `לקוח ${businessName || slug} — חריגה בלתי צפויה במהלך ביטול הוראת קבע.`,
          String(e instanceof Error ? e.message : e).slice(0, 500),
        ]);
        await sendEmail({ to: opsTo, subject: tpl.subject, htmlContent: tpl.htmlContent });
      } catch (err2) {
        console.error("[api/account/cancel-subscription] ops email (exception) failed:", err2);
      }
    }
  }

  try {
    const to = String((business as any)?.email ?? user.email ?? "")
      .trim()
      .toLowerCase();
    const displayName = businessName || (user.email ?? "").split("@")[0] || "שם";
    const until = formatDateDdMmYyyy(effective);
    if (to) {
      const tpl = cancellationRequestReceivedEmail(displayName, until);
      const r = await sendEmail({ to, subject: tpl.subject, htmlContent: tpl.htmlContent });
      console.info("[api/account/cancel-subscription] customer email", { to, ok: r.ok });
    } else {
      console.warn("[api/account/cancel-subscription] no customer email — skip");
    }
  } catch (e) {
    console.error("[api/account/cancel-subscription] customer email failed:", e);
  }

  return NextResponse.json({ ok: true, effective_at: effective.toISOString() });
}
