import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function toSlugBase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueSlug(admin: ReturnType<typeof createSupabaseAdminClient>, base: string) {
  const cleanBase = base || "business";
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? cleanBase : `${cleanBase}-${i + 1}`;
    const { data } = await admin
      .from("businesses")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  // fallback
  return `${cleanBase}-${Date.now().toString(36)}`;
}

async function ensurePrimaryBusinessUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  userId: string
) {
  const { error } = await admin.from("business_users").upsert(
    {
      business_id: businessId,
      user_id: userId,
      role: "admin",
      status: "active",
      is_primary: true,
    },
    { onConflict: "business_id,user_id" } as any
  );
  if (error) throw error;
}

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const emailConfirmed = Boolean((user as any).email_confirmed_at) || Boolean((user as any).confirmed_at);
  if (!emailConfirmed && user.app_metadata?.provider === "email") {
    return NextResponse.json({ error: "email_not_verified" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();

  // If business already exists for user, reuse it
  const { data: existing } = await admin
    .from("businesses")
    .select("id, slug")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing?.slug && existing.id) {
    try {
      await ensurePrimaryBusinessUser(admin, Number(existing.id), user.id);
    } catch (e: any) {
      console.error("[api/register/ensure-business] ensurePrimaryBusinessUser failed:", e?.message ?? e);
    }
    return NextResponse.json({ ok: true, slug: existing.slug });
  }

  const fullName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim()) ||
    "";
  const emailLocal = (user.email ?? "").split("@")[0] ?? "";
  const displayName = (fullName || emailLocal || "HeyZoe").trim();

  const baseSlug = toSlugBase(displayName);
  const slug = await ensureUniqueSlug(admin, baseSlug);

  const { data: insertedBiz, error } = await admin
    .from("businesses")
    .insert({
    user_id: user.id,
    slug,
    name: displayName,
    niche: "",
    bot_name: "זואי",
    social_links: {},
  } as any)
    .select("id, slug")
    .single();

  if (error) {
    console.error("[api/register/ensure-business] insert failed:", error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  try {
    await ensurePrimaryBusinessUser(admin, Number(insertedBiz.id), user.id);
  } catch (e: any) {
    console.error("[api/register/ensure-business] failed to create primary business_user:", e?.message ?? e);
    return NextResponse.json({ error: "membership_create_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, slug: insertedBiz.slug });
}

