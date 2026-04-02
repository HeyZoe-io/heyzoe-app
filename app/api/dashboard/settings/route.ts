import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const { data: business } = await admin
    .from("businesses")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) return NextResponse.json({ business: null, services: [], faqs: [] });

  const [{ data: services }, { data: faqs }] = await Promise.all([
    admin.from("services").select("*").eq("business_id", business.id).order("created_at", { ascending: true }),
    admin.from("faqs").select("*").eq("business_id", business.id).order("sort_order", { ascending: true }),
  ]);

  const socialRaw = business.social_links;
  const social =
    socialRaw && typeof socialRaw === "object" && !Array.isArray(socialRaw)
      ? (socialRaw as Record<string, unknown>)
      : {};

  return NextResponse.json({
    business: {
      ...business,
      plan: typeof (business as any).plan === "string" ? (business as any).plan : "basic",
      website_url: typeof social.website_url === "string" ? social.website_url : "",
      business_description:
        typeof social.business_description === "string" ? social.business_description : "",
      fact1: typeof social.fact1 === "string" ? social.fact1 : "",
      fact2: typeof social.fact2 === "string" ? social.fact2 : "",
      fact3: typeof social.fact3 === "string" ? social.fact3 : "",
      instagram: typeof social.instagram === "string" ? social.instagram : "",
      tiktok: typeof social.tiktok === "string" ? social.tiktok : "",
      facebook: typeof social.facebook === "string" ? social.facebook : "",
      youtube: typeof social.youtube === "string" ? social.youtube : "",
      whatsapp: typeof social.whatsapp === "string" ? social.whatsapp : "",
      age_range: typeof social.age_range === "string" ? social.age_range : "",
      gender:
        social.gender === "זכר" || social.gender === "נקבה" || social.gender === "הכול"
          ? social.gender
          : "הכול",
      target_audience: Array.isArray(social.target_audience) ? social.target_audience : [],
      benefits: Array.isArray(social.benefits) ? social.benefits : [],
      vibe: Array.isArray(social.vibe) ? social.vibe : [],
      schedule_text: typeof social.schedule_text === "string" ? social.schedule_text : "",
      facebook_pixel_id: typeof business.facebook_pixel_id === "string" ? business.facebook_pixel_id : "",
      conversions_api_token: typeof business.conversions_api_token === "string" ? business.conversions_api_token : "",
    },
    services: services ?? [],
    faqs: faqs ?? [],
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const business = body.business as Record<string, unknown>;
  const services = (body.services as Array<Record<string, unknown>>) ?? [];
  const faqs = (body.faqs as Array<Record<string, unknown>>) ?? [];

  const slug = String(business.slug ?? "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "slug_required" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: existingSlug } = await admin
    .from("businesses")
    .select("id, user_id")
    .eq("slug", slug)
    .maybeSingle();
  if (existingSlug && existingSlug.user_id !== user.id) {
    return NextResponse.json({ error: "slug_taken" }, { status: 403 });
  }

  const firstServiceWithCta = services.find(
    (s) => String(s.cta_text ?? "").trim() && String(s.cta_link ?? "").trim()
  );

  const upsertBusiness = {
    user_id: user.id,
    slug,
    name: String(business.name ?? ""),
    niche: String(business.niche ?? ""),
    bot_name: String(business.bot_name ?? "זואי"),
    logo_url: String(business.logo_url ?? ""),
    social_links:
      business.social_links && typeof business.social_links === "object"
        ? business.social_links
        : {},
    primary_color: String(business.primary_color ?? "#ff85cf"),
    secondary_color: String(business.secondary_color ?? "#bc74e9"),
    welcome_message: String(business.welcome_message ?? "נעים להכיר, אני זואי כאן ללוות אותך בדרך שלך."),
    cta_text: String(firstServiceWithCta?.cta_text ?? business.cta_text ?? ""),
    cta_link: String(firstServiceWithCta?.cta_link ?? business.cta_link ?? ""),
    facebook_pixel_id: String(business.facebook_pixel_id ?? ""),
    conversions_api_token: String(business.conversions_api_token ?? ""),
  };

  const { data: savedBiz, error: bizErr } = await admin
    .from("businesses")
    .upsert(upsertBusiness, { onConflict: "slug" })
    .select("id, slug")
    .single();
  if (bizErr || !savedBiz) return NextResponse.json({ error: bizErr?.message ?? "business_save_failed" }, { status: 400 });

  await admin.from("services").delete().eq("business_id", savedBiz.id);
  await admin.from("faqs").delete().eq("business_id", savedBiz.id);

  const servicesPayload = services.map((s) => ({
    business_id: savedBiz.id,
    name: String(s.name ?? ""),
    description: String(s.description ?? ""),
    location_mode: String(s.location_mode ?? "online"),
    location_text: String(s.location_text ?? ""),
    price_text: String(s.price_text ?? ""),
    service_slug: String(s.service_slug ?? ""),
  })).filter((s) => s.name && s.service_slug);

  let insertedServices: Array<{ id: number; service_slug: string }> = [];
  if (servicesPayload.length) {
    const { data } = await admin.from("services").insert(servicesPayload).select("id, service_slug");
    insertedServices = (data ?? []) as Array<{ id: number; service_slug: string }>;
  }

  const faqsPayload = faqs
    .map((f, i) => ({
      business_id: savedBiz.id,
      service_id:
        insertedServices.find((s) => s.service_slug === String(f.service_slug ?? ""))?.id ?? null,
      question: String(f.question ?? ""),
      answer: String(f.answer ?? ""),
      sort_order: i,
    }))
    .filter((f) => f.question && f.answer);

  if (faqsPayload.length) await admin.from("faqs").insert(faqsPayload);

  return NextResponse.json({ ok: true, slug: savedBiz.slug });
}
