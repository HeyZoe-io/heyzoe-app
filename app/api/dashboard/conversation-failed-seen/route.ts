import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
  type DashboardBizRow,
} from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { markFailedDeliverySeen } from "@/lib/wa-message-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** בעל עסק פתח שיחה עם הודעה שנכשלה: היא יורדת מרשימת «הודעות שנכשלו». פתיחה של אדמין לא נחשבת. */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isAdminAllowedEmail(user.email ?? "")) {
    return NextResponse.json({ ok: true, cleared: false, skipped: "admin" });
  }

  let body: { slug?: string; session_id?: string; phone?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const slug = normDashboardSlug(String(body.slug ?? ""));
  const sessionId = String(body.session_id ?? "").trim();
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  if (!sessionId) return NextResponse.json({ error: "missing_session_id" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id, { adminAll: false });
  const business = pickBusinessBySlug(accessible, slug) as DashboardBizRow | null;
  if (!business) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const result = await markFailedDeliverySeen(admin, {
    businessId: Number(business.id),
    phone: body.phone ?? null,
    sessionId,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, cleared: false, error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, cleared: true, rows: result.cleared });
}
