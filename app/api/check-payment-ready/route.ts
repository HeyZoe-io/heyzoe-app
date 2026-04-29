import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ ready: false });

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("payment_sessions")
      .select("ready, slug")
      .eq("email", email)
      .eq("ready", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.ready && data.slug) {
      // Self-heal: ensure business is marked active once the payment session is ready.
      // This prevents redirect loops where the IPN succeeded but `businesses.is_active`
      // wasn't updated (or was delayed).
      try {
        await admin
          .from("businesses")
          .update({ is_active: true, status: "active" } as any)
          .eq("slug", String(data.slug).trim().toLowerCase());
      } catch (e) {
        console.error("[api/check-payment-ready] business activate failed:", e);
      }
      return NextResponse.json({ ready: true, slug: data.slug });
    }
    return NextResponse.json({ ready: false });
  } catch (e) {
    console.error("[api/check-payment-ready] error:", e);
    return NextResponse.json({ ready: false });
  }
}

