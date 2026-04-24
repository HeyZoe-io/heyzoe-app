import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ state: "none" });

  try {
    const admin = createSupabaseAdminClient();

    const { data: authUser } = await admin
      .schema("auth")
      .from("users")
      .select("id,email")
      .eq("email", email)
      .maybeSingle();

    if (!authUser?.id) return NextResponse.json({ state: "none" });

    const { data: biz } = await admin
      .from("businesses")
      .select("slug,status,plan")
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const slug = biz?.slug ? String(biz.slug) : "";
    const status = biz?.status ? String(biz.status) : "";
    const plan = biz?.plan ? String(biz.plan) : "";

    // אם יש עסק פעיל — נחשב "משלם / מחובר"
    const isActive = status.toLowerCase() === "active";
    const isPaidPlan = plan === "basic" || plan === "premium";
    if (slug && (isActive || isPaidPlan)) {
      return NextResponse.json({ state: "existing_paying", slug });
    }

    return NextResponse.json({ state: "existing_unpaid", slug: slug || null });
  } catch (e) {
    console.error("[api/onboarding/email-status] error:", e);
    return NextResponse.json({ state: "unknown" }, { status: 200 });
  }
}

