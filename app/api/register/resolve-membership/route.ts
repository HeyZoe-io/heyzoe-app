import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();

  const { data: membership } = await admin
    .from("business_users")
    .select("business_id, role, status, is_primary")
    .eq("user_id", user.id)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!membership?.business_id) return NextResponse.json({ business: null });

  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug")
    .eq("id", membership.business_id)
    .maybeSingle();

  if (!biz?.slug) return NextResponse.json({ business: null });

  return NextResponse.json({
    business: {
      slug: String(biz.slug),
      role: membership.role === "admin" ? "admin" : "employee",
      status: membership.status === "active" ? "active" : "pending",
    },
  });
}

