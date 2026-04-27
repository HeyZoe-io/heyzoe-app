import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requestIcountStandingOrderStop } from "@/lib/icount-standing-order";
import { cancellationEmail, sendEmail } from "@/lib/email";

export const runtime = "nodejs";

/**
 * ביטול מנוי: רישום ב-DB. הוראת קבע ב-iCount — וובהוק אופציונלי (ICOUNT_STANDING_ORDER_CANCEL_WEBHOOK_URL)
 * או ביטול ידני בממשק iCount.
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
    .select("id, user_id, slug, name, email, cancellation_requested_at, cancellation_effective_at")
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

  const { error: updateErr } = await admin
    .from("businesses")
    .update({
      cancellation_requested_at: now.toISOString(),
      cancellation_effective_at: effective.toISOString(),
    })
    .eq("id", business.id)
    .eq("user_id", user.id);

  if (updateErr) {
    console.error("[api/account/cancel-subscription] update failed:", updateErr);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  if (user.email) {
    void requestIcountStandingOrderStop({ customerEmail: user.email });
  }

  // Cancellation email (best-effort)
  try {
    const to = String((business as any)?.email ?? user.email ?? "").trim().toLowerCase();
    const businessName = String((business as any)?.name ?? "").trim();
    const slug = String((business as any)?.slug ?? "").trim().toLowerCase();
    const accessUntil = effective.toLocaleDateString("he-IL");
    const dashboardUrl = slug ? `https://heyzoe.io/${slug}/analytics` : "https://heyzoe.io";
    if (to && businessName) {
      const tpl = cancellationEmail(businessName, accessUntil, dashboardUrl);
      await sendEmail({ to, subject: tpl.subject, htmlContent: tpl.htmlContent });
    }
  } catch (e) {
    console.error("[api/account/cancel-subscription] cancellation email failed:", e);
  }

  return NextResponse.json({ ok: true, effective_at: effective.toISOString() });
}
