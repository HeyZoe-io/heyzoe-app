import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadAccessibleBusinesses, normDashboardSlug, pickBusinessBySlug } from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = normDashboardSlug(req.nextUrl.searchParams.get("slug") ?? "");
  if (!slug) return NextResponse.json({ error: "slug_required" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id, {
    adminAll: isAdminAllowedEmail(user.email ?? ""),
  });
  const biz = pickBusinessBySlug(accessible, slug);
  if (!biz) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data, error } = await admin
    .from("whatsapp_channels")
    .select("phone_display, provisioning_status, is_active, created_at")
    .eq("business_slug", slug)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const statusRaw = String((data as any)?.provisioning_status ?? "").trim();
  const provisioning_status =
    statusRaw === "pending" || statusRaw === "active" || statusRaw === "failed"
      ? (statusRaw as "pending" | "active" | "failed")
      : data
        ? ((data as any).is_active ? "active" : "pending")
        : null;

  return NextResponse.json({
    channel: data
      ? {
          phone_display: String((data as any).phone_display ?? "").trim(),
          provisioning_status,
        }
      : null,
  });
}

