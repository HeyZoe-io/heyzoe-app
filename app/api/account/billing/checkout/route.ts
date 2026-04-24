import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { plan?: string } | null;
  const plan = body?.plan === "pro" ? "pro" : "starter";

  const email = String(user.email ?? "").trim();
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  const first_name =
    (typeof (user as any).user_metadata?.first_name === "string" && (user as any).user_metadata.first_name.trim()) ||
    "";
  const last_name =
    (typeof (user as any).user_metadata?.last_name === "string" && (user as any).user_metadata.last_name.trim()) ||
    "";
  const phone = typeof user.phone === "string" ? user.phone.trim() : "";

  const res = await fetch(`${req.nextUrl.origin}/api/icount-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, email, first_name, last_name, phone }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: data?.error ?? "checkout_failed" }, { status: res.status });
  }
  return NextResponse.json({ url: data?.url ?? "" });
}

