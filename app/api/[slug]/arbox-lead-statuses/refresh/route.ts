import { NextRequest, NextResponse } from "next/server";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { refreshArboxLeadStatusCatalog } from "@/lib/leads/arbox-lead-status-change";
import { leadStatusRefreshArboxError } from "@/lib/leads/lead-status-picker";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * POST /api/[slug]/arbox-lead-statuses/refresh
 * One leadsInProcessReport pull so the no-answer picker can list statuses
 * before a rule exists. Writes known statuses only. No cron.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { data: business, error: businessErr } = await admin
    .from("businesses")
    .select("crm_type, crm_api_key, crm_box_id")
    .eq("id", access.business.id)
    .maybeSingle();
  if (businessErr) {
    console.error("[api/arbox-lead-statuses] business lookup failed:", businessErr.message);
    return NextResponse.json({ error: "business_lookup_failed", statuses: [] }, { status: 500 });
  }
  if (leadStatusRefreshArboxError(business)) {
    return NextResponse.json({ error: "arbox_not_connected", statuses: [] }, { status: 400 });
  }

  const result = await refreshArboxLeadStatusCatalog({
    admin,
    businessId: access.business.id,
    apiKey: String(business?.crm_api_key ?? ""),
    boxId: String(business?.crm_box_id ?? ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, statuses: result.statuses }, { status: 502 });
  }
  return NextResponse.json({ statuses: result.statuses, throttled: result.throttled });
}
