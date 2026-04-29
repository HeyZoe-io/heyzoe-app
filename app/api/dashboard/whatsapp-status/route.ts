import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

type MetaStatus = "CONNECTED" | "PENDING" | "UNVERIFIED";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = String(req.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "slug_required" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id, user_id")
    .eq("slug", slug)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!biz) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: job } = await admin
    .from("wa_provision_jobs")
    .select("meta_phone_number_id, status, created_at")
    .eq("business_slug", slug)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const metaPhoneNumberId = String((job as any)?.meta_phone_number_id ?? "").trim();
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
      statusRaw === "CONNECTED" || statusRaw === "PENDING" || statusRaw === "UNVERIFIED"
        ? (statusRaw as MetaStatus)
        : "UNVERIFIED";

    return NextResponse.json({ status });
  } catch (e) {
    console.error("[api/dashboard/whatsapp-status] error:", e);
    return NextResponse.json({ error: "meta_graph_failed" }, { status: 502 });
  }
}

