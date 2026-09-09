import { NextRequest, NextResponse } from "next/server";
import {
  businessQualifiesForArboxScheduleSync,
  fetchArboxClassDescriptionForProduct,
} from "@/lib/arbox-schedule-sync";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
} from "@/lib/dashboard-business-access";
import { generateProductDescriptionFromContext } from "@/lib/fetch-site-scan";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

async function resolveClassSourceFromArbox(input: {
  userId: string;
  email: string;
  slugRaw: unknown;
  productName: unknown;
  arboxBoxCategoryId: unknown;
  arboxClassName: unknown;
  stored: string;
}): Promise<string> {
  const slug = normDashboardSlug(input.slugRaw);
  if (!slug) return input.stored;

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, input.userId, {
    adminAll: isAdminAllowedEmail(input.email),
  });
  const biz = pickBusinessBySlug(accessible, slug);
  if (!biz || !businessQualifiesForArboxScheduleSync(biz)) return input.stored;

  const apiKey = String((biz as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
  if (!apiKey) return input.stored;

  const pulled = await fetchArboxClassDescriptionForProduct({
    apiKey,
    arbox_box_category_id: parsePositiveId(input.arboxBoxCategoryId),
    arbox_class_name: String(input.arboxClassName ?? "").trim(),
    product_name: String(input.productName ?? "").trim(),
  });
  if (!pulled.ok) {
    console.error("[api/dashboard/generate-product-description] arbox class description fetch failed", {
      slug,
      error: pulled.error,
      status: pulled.status ?? null,
    });
    return input.stored;
  }
  return pulled.description.trim() || input.stored;
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const storedClassSource = String(body.class_source_text ?? "").trim();
  const classSourceText = await resolveClassSourceFromArbox({
    userId: user.id,
    email: user.email ?? "",
    slugRaw: body.slug,
    productName: body.product_name,
    arboxBoxCategoryId: body.arbox_box_category_id,
    arboxClassName: body.arbox_class_name,
    stored: storedClassSource,
  });

  const result = await generateProductDescriptionFromContext({
    website_url: String(body.website_url ?? ""),
    business_name: String(body.business_name ?? ""),
    niche: String(body.niche ?? ""),
    business_tagline: String(body.business_tagline ?? ""),
    business_traits: Array.isArray(body.business_traits)
      ? body.business_traits.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [],
    product_name: String(body.product_name ?? ""),
    offer_kind: String(body.offer_kind ?? ""),
    price_text: String(body.price_text ?? ""),
    duration: String(body.duration ?? ""),
    description_current: String(body.description_current ?? ""),
    class_source_text: classSourceText,
    location_mode: String(body.location_mode ?? ""),
    course_dates_enabled: body.course_dates_enabled !== false,
  });

  if (result.status === 200 && classSourceText) {
    return NextResponse.json(
      { ...result.body, arbox_class_description: classSourceText },
      { status: 200 }
    );
  }

  return NextResponse.json(result.body, { status: result.status });
}
