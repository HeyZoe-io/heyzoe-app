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

type ChannelRow = {
  phone_display?: string | null;
  provisioning_status?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  business_id?: number | null;
  business_slug?: string | null;
};

async function loadWhatsAppChannel(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string,
  businessId: number | null
): Promise<ChannelRow | null> {
  const selectCols = "phone_display, provisioning_status, is_active, created_at, business_id, business_slug";

  // 1) ערוץ פעיל לפי slug
  {
    const { data } = await admin
      .from("whatsapp_channels")
      .select(selectCols)
      .eq("business_slug", slug)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as ChannelRow;
  }

  // 2) ערוץ פעיל לפי business_id (אם ה-slug בערוץ לא תואם)
  if (businessId != null && Number.isFinite(businessId)) {
    const { data } = await admin
      .from("whatsapp_channels")
      .select(selectCols)
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as ChannelRow;
  }

  // 3) נפילה אחרונה לפי slug (גם אם לא פעיל — לתצוגת pending/failed)
  {
    const { data } = await admin
      .from("whatsapp_channels")
      .select(selectCols)
      .eq("business_slug", slug)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as ChannelRow;
  }

  if (businessId != null && Number.isFinite(businessId)) {
    const { data } = await admin
      .from("whatsapp_channels")
      .select(selectCols)
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as ChannelRow;
  }

  return null;
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
  const zoeActivated = Boolean((biz as { zoe_activated?: boolean | null }).zoe_activated);
  const businessId = Number((biz as { id?: unknown }).id);
  const bizId = Number.isFinite(businessId) ? businessId : null;

  const data = await loadWhatsAppChannel(admin, slug, bizId);

  const phoneDisplay = String(data?.phone_display ?? "").trim();
  const isActive = Boolean(data?.is_active);
  const statusRaw = String(data?.provisioning_status ?? "").trim();

  // ערוץ פעיל עם מספר (טוויליו / Meta) — מציגים כמחובר גם אחרי איפוס screencast
  // שהשאיר provisioning_status=failed בזמן ש-is_active כבר true.
  let provisioning_status: "pending" | "active" | "failed" | null = null;
  if (!data) {
    provisioning_status = null;
  } else if (isActive && phoneDisplay) {
    provisioning_status = statusRaw === "pending" ? "pending" : "active";
  } else if (statusRaw === "pending" || statusRaw === "active" || statusRaw === "failed") {
    provisioning_status = statusRaw;
  } else {
    provisioning_status = isActive ? "active" : "pending";
  }

  return NextResponse.json({
    channel: data
      ? {
          phone_display: phoneDisplay,
          provisioning_status,
          is_active: isActive,
        }
      : null,
    zoe_activated: zoeActivated,
  });
}
