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

type MetaStatus = "CONNECTED" | "PENDING" | "UNVERIFIED" | "DISCONNECTED";

async function resolveMetaPhoneNumberId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string,
  businessId: number | null
): Promise<string> {
  const { data: job } = await admin
    .from("wa_provision_jobs")
    .select("meta_phone_number_id, status, created_at")
    .eq("business_slug", slug)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fromJob = String((job as { meta_phone_number_id?: unknown } | null)?.meta_phone_number_id ?? "").trim();
  if (fromJob) return fromJob;

  {
    const { data: channel } = await admin
      .from("whatsapp_channels")
      .select("phone_number_id")
      .eq("business_slug", slug)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fromSlug = String((channel as { phone_number_id?: unknown } | null)?.phone_number_id ?? "").trim();
    if (fromSlug) return fromSlug;
  }

  if (businessId != null && Number.isFinite(businessId)) {
    const { data: channel } = await admin
      .from("whatsapp_channels")
      .select("phone_number_id")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return String((channel as { phone_number_id?: unknown } | null)?.phone_number_id ?? "").trim();
  }

  return "";
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
  const businessId = Number((biz as { id?: unknown }).id);
  const bizId = Number.isFinite(businessId) ? businessId : null;

  const metaPhoneNumberId = await resolveMetaPhoneNumberId(admin, slug, bizId);
  if (!metaPhoneNumberId) return NextResponse.json({ status: "not_provisioned" });

  const token = String(process.env.WHATSAPP_SYSTEM_TOKEN ?? "").trim();
  if (!token) return NextResponse.json({ error: "missing_whatsapp_system_token" }, { status: 500 });

  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(
      metaPhoneNumberId
    )}?fields=status,verified_name,display_phone_number`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      console.error("[api/dashboard/whatsapp-status] meta_graph_error:", {
        status: res.status,
        body: j,
        slug,
      });
      return NextResponse.json({ error: "meta_graph_failed" }, { status: 502 });
    }

    const statusRaw = String(j.status ?? "").trim().toUpperCase();
    const status: MetaStatus =
      statusRaw === "CONNECTED" ||
      statusRaw === "PENDING" ||
      statusRaw === "UNVERIFIED" ||
      statusRaw === "DISCONNECTED"
        ? (statusRaw as MetaStatus)
        : "UNVERIFIED";

    return NextResponse.json({ status });
  } catch (e) {
    console.error("[api/dashboard/whatsapp-status] error:", e);
    return NextResponse.json({ error: "meta_graph_failed" }, { status: 502 });
  }
}

