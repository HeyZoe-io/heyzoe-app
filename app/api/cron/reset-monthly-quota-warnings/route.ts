import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { getIsraelCalendarDay } from "@/lib/israel-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/reset-monthly-quota-warnings] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * מאפס דגלי מייל מכסה ב־businesses ביום 1 בלוח הישראלי (בדיקה בכל קריאה — ה-cron רץ פעם ביום).
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/reset-monthly-quota-warnings] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (getIsraelCalendarDay(new Date()) !== 1) {
    return NextResponse.json({ ok: true, skipped: true, reason: "not_il_first_of_month" });
  }

  const admin = createSupabaseAdminClient();
  const patch = {
    quota_warning_20_sent_at: null,
    quota_warning_5_sent_at: null,
    quota_limit_sent_at: null,
    quota_pro_warning_sent_at: null,
  } as Record<string, unknown>;

  const { error } = await admin.from("businesses").update(patch as any).gte("id", 0);

  if (error) {
    console.error("[cron/reset-monthly-quota-warnings] update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.info("[cron/reset-monthly-quota-warnings] reset quota email flags for all businesses (IL month start)");
  return NextResponse.json({ ok: true, reset: true });
}
