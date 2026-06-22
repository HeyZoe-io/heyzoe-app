import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { canWriteForSlug } from "@/lib/onboarding-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ONBOARDING_TYPES = ["coexistence", "new_provisioned", "manual"] as const;
type OnboardingType = (typeof VALID_ONBOARDING_TYPES)[number];

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

export async function POST(req: NextRequest) {
  let body: {
    businessSlug?: unknown;
    email?: unknown;
    onboarding_type?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const businessSlug = normalizeSlug(body.businessSlug);
  const proofEmail = normalizeEmail(body.email);
  const onboardingType = String(body.onboarding_type ?? "").trim();

  if (!businessSlug) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!VALID_ONBOARDING_TYPES.includes(onboardingType as OnboardingType)) {
    return NextResponse.json({ error: "invalid_onboarding_type" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  const admin = createSupabaseAdminClient();
  const allowed = await canWriteForSlug(admin, businessSlug, userId, proofEmail);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await admin
    .from("businesses")
    .update({ onboarding_type: onboardingType, updated_at: new Date().toISOString() } as any)
    .eq("slug", businessSlug);

  if (error) {
    if (/onboarding_type|column/i.test(error.message)) {
      return NextResponse.json(
        {
          error:
            "חסרה עמודת onboarding_type בטבלת businesses. הריצו את ה-migration המתאים ב-Supabase.",
        },
        { status: 400 }
      );
    }
    console.error("[set-onboarding-type] update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.info(
    `[set-onboarding-type] updated businesses.onboarding_type=${onboardingType} for slug=${businessSlug}`
  );

  return NextResponse.json({ success: true });
}
