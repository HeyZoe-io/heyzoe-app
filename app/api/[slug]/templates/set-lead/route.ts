import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * POST /api/[slug]/templates/set-lead
 * Body: { template_name } — must be an APPROVED cached template for this business.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const templateName = String(body.template_name ?? "").trim();
  if (!templateName) {
    return NextResponse.json({ error: "missing_template_name" }, { status: 400 });
  }

  const { data: tpl, error: tplErr } = await admin
    .from("whatsapp_templates")
    .select("id, name, status")
    .eq("business_id", access.business.id)
    .eq("name", templateName)
    .eq("status", "APPROVED")
    .limit(1)
    .maybeSingle();

  if (tplErr) {
    console.error("[api/templates/set-lead] lookup failed:", tplErr.message);
    return NextResponse.json({ error: "template_lookup_failed" }, { status: 500 });
  }
  if (!tpl?.id) {
    // Distinguish missing vs not approved for clearer client errors.
    const { data: anyStatus } = await admin
      .from("whatsapp_templates")
      .select("id, status")
      .eq("business_id", access.business.id)
      .eq("name", templateName)
      .limit(1)
      .maybeSingle();
    if (!anyStatus?.id) {
      return NextResponse.json({ error: "template_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "template_not_approved" }, { status: 400 });
  }

  const { error: updErr } = await admin
    .from("businesses")
    .update({
      lead_template_name: templateName,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq("id", access.business.id);

  if (updErr) {
    console.error("[api/templates/set-lead] update failed:", updErr.message);
    return NextResponse.json({ error: "lead_template_update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lead_template_name: templateName });
}
