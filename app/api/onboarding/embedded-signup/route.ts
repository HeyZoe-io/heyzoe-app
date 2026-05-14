import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSlug(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

function normalizeEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Allow saving WABA if the caller owns the business (session) or proves email matches
 * the business row / a ready payment session for that slug (onboarding success page).
 */
async function canWriteWabaForSlug(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string,
  userId: string | null,
  proofEmail: string
): Promise<boolean> {
  const { data: biz } = await admin.from("businesses").select("id, user_id, email").eq("slug", slug).maybeSingle();
  if (!biz) return false;
  const row = biz as { id?: unknown; user_id?: unknown; email?: unknown };
  if (userId && String(row.user_id ?? "") === userId) return true;
  if (!proofEmail) return false;
  const bizEmail = normalizeEmail(row.email);
  if (bizEmail && bizEmail === proofEmail) return true;
  const { data: ps } = await admin
    .from("payment_sessions")
    .select("id")
    .eq("slug", slug)
    .eq("email", proofEmail)
    .eq("ready", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(ps);
}

export async function POST(req: NextRequest) {
  let body: { code?: unknown; waba_id?: unknown; businessSlug?: unknown; email?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const code = String(body.code ?? "").trim();
  const waba_id = String(body.waba_id ?? "").trim().replace(/\s+/g, "");
  const businessSlug = normalizeSlug(body.businessSlug);
  const proofEmail = normalizeEmail(body.email);

  if (!code || !waba_id || !businessSlug) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  const admin = createSupabaseAdminClient();
  const allowed = await canWriteWabaForSlug(admin, businessSlug, userId, proofEmail);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await admin
    .from("businesses")
    .update({ waba_id, updated_at: new Date().toISOString() } as any)
    .eq("slug", businessSlug);

  if (error) {
    if (/waba_id|column/i.test(error.message)) {
      return NextResponse.json(
        {
          error:
            "חסרה עמודת waba_id בטבלת businesses. הריצו ב-Supabase: supabase/businesses_waba_id.sql",
        },
        { status: 400 }
      );
    }
    console.error("[embedded-signup] update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // `code` reserved for a later server exchange with Meta; not persisted here.
  void code;

  return NextResponse.json({ success: true });
}
