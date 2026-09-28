import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { dismissUtilityRecategoryNotices } from "@/lib/template-category-notice";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * POST /api/[slug]/templates/category-notice
 * Body: { ids: string[] } — a real business user closed the UTILITY→MARKETING popup.
 * Platform admin closes are not stored, so the popup still shows for the business.
 * One indexed update for this business. No Meta call.
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

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (isAdminAllowedEmail(user.user.email ?? "")) {
    return NextResponse.json({ ok: true, persisted: false, dismissed: 0 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id ?? "")) : [];
  try {
    const dismissed = await dismissUtilityRecategoryNotices(admin, access.business.id, ids);
    return NextResponse.json({ ok: true, persisted: true, dismissed });
  } catch (e) {
    console.error("[api/templates/category-notice] dismiss failed:", e);
    return NextResponse.json({ error: "dismiss_failed" }, { status: 500 });
  }
}
