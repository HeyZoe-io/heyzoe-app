import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const userEmail = String(data.user?.email ?? "").trim().toLowerCase();
    const allowedEmail = String(resolveAdminAllowedEmail() ?? "").trim().toLowerCase();
    const allowed = Boolean(userEmail && allowedEmail && userEmail === allowedEmail);
    return NextResponse.json({ allowed });
  } catch (e) {
    console.error("[api/admin/is-allowed] error:", e);
    return NextResponse.json({ allowed: false });
  }
}

