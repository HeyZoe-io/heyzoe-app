import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function noStore(body: { ready: boolean; slug?: string }) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return noStore({ ready: false });

  try {
    const admin = createSupabaseAdminClient();
    const { data: rows, error: sessionErr } = await admin
      .from("payment_sessions")
      .select("ready, slug")
      .eq("email", email)
      .eq("ready", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (sessionErr) {
      console.error("[api/check-payment-ready] session query failed:", sessionErr.message);
      return noStore({ ready: false });
    }
    const data = rows?.[0] as { ready?: boolean; slug?: string } | undefined;

    if (data?.ready && data.slug) {
      const slug = String(data.slug).trim().toLowerCase();

      const { data: biz, error: bizErr } = await admin
        .from("businesses")
        .select("is_active")
        .eq("slug", slug)
        .maybeSingle();
      if (bizErr) {
        console.error("[api/check-payment-ready] business check failed:", bizErr);
        return noStore({ ready: false });
      }
      if (!biz) return noStore({ ready: false });
      if (Boolean((biz as { is_active?: boolean | null }).is_active)) {
        return noStore({ ready: true, slug });
      }

      // Self-heal only when the row exists but is not active yet — do not block
      // the common path (already active) on this update.
      const { error: actErr } = await admin
        .from("businesses")
        .update({ is_active: true, status: "active" })
        .eq("slug", slug);
      if (actErr) {
        console.error("[api/check-payment-ready] business activate failed:", actErr.message);
        return noStore({ ready: false });
      }
      return noStore({ ready: true, slug });
    }
    return noStore({ ready: false });
  } catch (e) {
    console.error("[api/check-payment-ready] error:", e);
    return noStore({ ready: false });
  }
}

