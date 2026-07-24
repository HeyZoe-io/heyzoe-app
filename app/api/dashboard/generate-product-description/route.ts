import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { generateProductDescriptionFromContext } from "@/lib/fetch-site-scan";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const result = await generateProductDescriptionFromContext({
    website_url: body.website_url,
    business_name: body.business_name,
    niche: body.niche,
    business_tagline: body.business_tagline,
    business_traits: body.business_traits,
    product_name: body.product_name,
    offer_kind: body.offer_kind,
    price_text: body.price_text,
    duration: body.duration,
    description_current: body.description_current,
    location_mode: body.location_mode,
    course_dates_enabled: body.course_dates_enabled,
  });

  return NextResponse.json(result.body, { status: result.status });
}
