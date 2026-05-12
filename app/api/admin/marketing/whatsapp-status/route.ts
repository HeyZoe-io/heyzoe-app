import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETING_META_PHONE_NUMBER_ID = "1179786855208358";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = String(process.env.WHATSAPP_SYSTEM_TOKEN ?? "").trim();
  if (!token) {
    return NextResponse.json({ error: "missing_whatsapp_system_token" }, { status: 500 });
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(
      MARKETING_META_PHONE_NUMBER_ID
    )}?fields=status,verified_name,display_phone_number`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      console.error("[admin/marketing/whatsapp-status] meta_graph_error:", { status: res.status, body: j });
      return NextResponse.json({ error: "meta_graph_failed" }, { status: 502 });
    }

    const statusRaw = String(j.status ?? "").trim().toUpperCase();
    const status =
      statusRaw === "CONNECTED" || statusRaw === "PENDING" || statusRaw === "UNVERIFIED"
        ? statusRaw
        : "UNVERIFIED";

    return NextResponse.json({ status });
  } catch (e) {
    console.error("[admin/marketing/whatsapp-status] error:", e);
    return NextResponse.json({ error: "meta_graph_failed" }, { status: 502 });
  }
}
