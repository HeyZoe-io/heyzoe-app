import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

async function findAuthUserIdByEmail(admin: ReturnType<typeof createSupabaseAdminClient>, email: string): Promise<string | null> {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;

  // Some Supabase projects do not expose the `auth` schema via PostgREST, so we
  // must use the Auth Admin API instead of querying auth.users directly.
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage } as any);
    if (error) throw error;
    const users = (data?.users ?? []) as Array<{ id: string; email?: string | null }>;
    if (users.length === 0) break;
    const found = users.find((u) => String(u.email ?? "").trim().toLowerCase() === target);
    if (found?.id) return String(found.id);
    if (users.length < perPage) break;
  }

  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ state: "none" });

  try {
    const admin = createSupabaseAdminClient();
    const authUserId = await findAuthUserIdByEmail(admin, email);
    if (!authUserId) return NextResponse.json({ state: "none" });

    const { data: biz } = await admin
      .from("businesses")
      .select("slug,is_active")
      .eq("user_id", authUserId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const slug = biz?.slug ? String(biz.slug) : "";
    const isActive = Boolean((biz as any)?.is_active);

    // אם יש מנוי פעיל — החשבון "משלם"
    if (slug && isActive) {
      return NextResponse.json({ state: "existing_paying", slug });
    }

    return NextResponse.json({ state: "existing_unpaid", slug: slug || null });
  } catch (e) {
    console.error("[api/onboarding/email-status] error:", e);
    return NextResponse.json({ state: "unknown" }, { status: 200 });
  }
}

