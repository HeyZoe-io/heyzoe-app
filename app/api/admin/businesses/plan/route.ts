import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { PLAN_PRICE_PRO_ILS, PLAN_PRICE_STARTER_ILS } from "@/lib/plan-prices";

export const runtime = "nodejs";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    const closeIntro = body.closeIntro === "starter" || body.closeIntro === "pro" ? body.closeIntro : "";
    const plan = body.plan === "premium" ? "premium" : body.plan === "basic" ? "basic" : "";
    if (!slug || (!plan && !closeIntro)) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    if (closeIntro) {
      const nextPlan = closeIntro === "pro" ? "premium" : "basic";
      const nextPrice = closeIntro === "pro" ? PLAN_PRICE_PRO_ILS : PLAN_PRICE_STARTER_ILS;
      const { data, error } = await admin
        .from("businesses")
        .update({
          plan: nextPlan,
          plan_price: nextPrice,
          intro_full_price_at: new Date().toISOString(),
        })
        .eq("slug", slug)
        .not("intro_period_ends_at", "is", null)
        .is("intro_full_price_at", null)
        .select("slug, plan, plan_price, intro_full_price_at")
        .maybeSingle();

      if (error) {
        console.error("[api/admin/businesses/plan] close intro failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) return NextResponse.json({ error: "intro_not_open" }, { status: 404 });
      return NextResponse.json({ business: data });
    }

    const { data, error } = await admin
      .from("businesses")
      .update({ plan })
      .eq("slug", slug)
      .select("slug, plan")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "business_not_found" }, { status: 404 });
    return NextResponse.json({ business: data });
  } catch (e) {
    console.error("[api/admin/businesses/plan] failed:", e);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}

