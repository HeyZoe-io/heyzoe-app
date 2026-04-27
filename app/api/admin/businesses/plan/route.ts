import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";

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
    const plan = body.plan === "premium" ? "premium" : body.plan === "basic" ? "basic" : "";
    if (!slug || !plan) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
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

