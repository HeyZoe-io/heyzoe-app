import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { syncWabaTemplatesToDb } from "@/lib/meta-templates";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * GET /api/[slug]/templates
 * - Plain GET: cached rows from whatsapp_templates only (no Meta call).
 * - ?refresh=1: sync from Meta first (skipped if businesses.waba_id empty → noRefresh:true).
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const refresh =
    String(req.nextUrl.searchParams.get("refresh") ?? "").trim() === "1";

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

  const businessId = access.business.id;
  let synced: number | null = null;
  let noRefresh = false;

  if (refresh) {
    const { data: bizRow, error: bizErr } = await admin
      .from("businesses")
      .select("waba_id")
      .eq("id", businessId)
      .maybeSingle();
    if (bizErr) {
      console.error("[api/templates] waba_id lookup failed:", bizErr.message);
      return NextResponse.json({ error: "business_lookup_failed" }, { status: 500 });
    }
    const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
      .trim()
      .replace(/\s+/g, "");
    if (!wabaId) {
      noRefresh = true;
    } else {
      try {
        synced = await syncWabaTemplatesToDb(admin, businessId, wabaId);
      } catch (e) {
        console.error("[api/templates] Meta sync failed:", e);
        return NextResponse.json(
          {
            error: "template_sync_failed",
            detail: e instanceof Error ? e.message : String(e),
          },
          { status: 502 }
        );
      }
    }
  }

  const { data: templates, error: listErr } = await admin
    .from("whatsapp_templates")
    .select(
      "id, business_id, waba_template_id, name, category, language, status, components, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false });

  if (listErr) {
    console.error("[api/templates] list failed:", listErr.message);
    return NextResponse.json({ error: "template_list_failed" }, { status: 500 });
  }

  return NextResponse.json({
    templates: templates ?? [],
    ...(synced != null ? { synced } : {}),
    ...(noRefresh ? { noRefresh: true } : {}),
  });
}
