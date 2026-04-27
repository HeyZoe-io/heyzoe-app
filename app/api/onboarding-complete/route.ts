import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendEmail, welcomeEmail } from "@/lib/email";

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
    const { data } = await admin.from("businesses").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
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

export async function POST(req: NextRequest) {
  try {
    const {
      first_name,
      last_name,
      phone,
      email,
      password,
      studio_name,
      business_type,
      description,
      address,
      plan,
    } = (await req.json()) as {
      first_name?: string;
      last_name?: string;
      phone?: string;
      email?: string;
      password?: string;
      studio_name?: string;
      business_type?: string;
      description?: string;
      address?: string;
      plan?: "starter" | "pro";
    };

    if (!email?.trim() || !studio_name?.trim() || !password || password.length < 8) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const slug = await ensureUniqueSlug(admin, toSlugBase(studio_name));

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email.trim(),
      phone: phone?.trim() || undefined,
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: first_name?.trim() || "",
        last_name: last_name?.trim() || "",
      },
    });

    if (authError || !authData.user) throw authError ?? new Error("user_create_failed");

    const { data: insertedBiz, error: bizError } = await admin
      .from("businesses")
      .insert({
        user_id: authData.user.id,
        slug,
        name: studio_name.trim(),
        niche: business_type?.trim() || "",
        bot_name: "זואי",
        social_links: {
          address: address?.trim() || "",
          business_description: description?.trim() || "",
        },
        plan: plan === "pro" ? "premium" : "basic",
      } as any)
      .select("id, slug")
      .single();

    if (bizError || !insertedBiz) throw bizError ?? new Error("business_create_failed");

    await ensurePrimaryBusinessUser(admin, Number(insertedBiz.id), authData.user.id);

    // Welcome email (best-effort)
    try {
      const to = email.trim().toLowerCase();
      const businessName = studio_name.trim();
      const dashboardUrl = `https://heyzoe.io/${String(insertedBiz.slug).trim().toLowerCase()}/analytics`;
      const tpl = welcomeEmail(businessName, dashboardUrl);
      await sendEmail({ to, subject: tpl.subject, htmlContent: tpl.htmlContent });
    } catch (e) {
      console.error("[api/onboarding-complete] welcome email failed:", e);
    }

    return NextResponse.json({ success: true, slug: insertedBiz.slug });
  } catch (error) {
    console.error("[api/onboarding-complete] error:", error);
    return NextResponse.json({ error: "שגיאה בשמירת פרטים" }, { status: 500 });
  }
}

