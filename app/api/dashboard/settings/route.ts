import { NextRequest, NextResponse } from "next/server";
import { truncateTrialServiceName } from "@/lib/trial-service";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
  pickFirstBusiness,
  type DashboardBizRow,
} from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

function normSlug(s: unknown): string {
  return normDashboardSlug(s);
}

function latinSlugPart(input: string): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** שמות שירות בעברית בלבד נתנו slug ריק — לפני כן השורות לא נשמרו בכלל */
function ensureServiceInsertSlug(name: string, provided: string, rowIndex: number): string {
  let s = latinSlugPart(provided);
  if (s.length >= 2) return s.slice(0, 80);
  s = latinSlugPart(name);
  if (s.length >= 2) return s.slice(0, 80);
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `trial-${rowIndex}-${Math.abs(h).toString(36)}`.slice(0, 80);
}

type BizRow = DashboardBizRow;

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slugFilter = normSlug(req.nextUrl.searchParams.get("slug") ?? "");

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id);
  const business = slugFilter
    ? pickBusinessBySlug(accessible, slugFilter)
    : pickFirstBusiness(accessible);

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
      tagline: typeof social.tagline === "string" ? social.tagline : "",
      traits: Array.isArray(social.traits) ? social.traits.map(String) : [],
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
  let shouldReplaceServices = Array.isArray(body.services);
  const shouldReplaceFaqs = Array.isArray(body.faqs);
  const services = shouldReplaceServices ? (body.services as Array<Record<string, unknown>>) : [];
  const faqs = shouldReplaceFaqs ? (body.faqs as Array<Record<string, unknown>>) : [];

  const slug = String(business.slug ?? "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "slug_required" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id);
  const existingForUser = pickBusinessBySlug(accessible, slug);

  const { data: rowExactSlug } = await admin.from("businesses").select("id, user_id, slug").eq("slug", slug).maybeSingle();

  if (rowExactSlug && (!existingForUser || Number(rowExactSlug.id) !== Number(existingForUser.id))) {
    return NextResponse.json({ error: "slug_taken" }, { status: 403 });
  }

  /** שמירה על slug כפי שב-DB (רישיות) ועל בעלות — חשוב לחברי צוות ול-URL */
  const canonicalSlug = existingForUser ? String(existingForUser.slug ?? slug) : slug;
  const ownerUserId = existingForUser ? String(existingForUser.user_id ?? user.id) : user.id;

  const firstServiceWithCta = services.find(
    (s) => String(s.cta_text ?? "").trim() && String(s.cta_link ?? "").trim()
  );

  const incomingSocial =
    business.social_links &&
    typeof business.social_links === "object" &&
    !Array.isArray(business.social_links)
      ? ({ ...(business.social_links as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const prevSocial =
    existingForUser?.social_links &&
    typeof existingForUser.social_links === "object" &&
    !Array.isArray(existingForUser.social_links)
      ? (existingForUser.social_links as Record<string, unknown>)
      : {};

  const mergedSocial: Record<string, unknown> = { ...prevSocial, ...incomingSocial };
  delete mergedSocial.arbox_memberships_url;
  delete mergedSocial.arbox_integration_notes;
  delete mergedSocial.arbox_api_key;
  delete mergedSocial.arbox_schedule_prompt_text;
  delete mergedSocial.arbox_box_categories_prompt_text;
  delete mergedSocial.arbox_public_sync_at;

  const upsertBusiness = {
    user_id: ownerUserId,
    slug: canonicalSlug,
    name: String(business.name ?? ""),
    niche: String(business.niche ?? ""),
    bot_name: String(business.bot_name ?? "זואי"),
    logo_url: String(business.logo_url ?? ""),
    social_links: mergedSocial,
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

  if (existingForUser && Number(savedBiz.id) !== Number(existingForUser.id)) {
    return NextResponse.json({ error: "business_save_failed" }, { status: 400 });
  }

  let insertedServices: Array<{ id: number; service_slug: string }> = [];
  if (shouldReplaceServices) {
    // Safety: never wipe services due to an empty payload (can happen if the client autosaves before hydrating,
    // or if a transient load issue results in an empty services array).
    // If the user truly wants to remove all services, we should add an explicit "danger" action + flag.
    const hasNamedService = services.some((s) => String(s.name ?? "").trim());
    if (!hasNamedService) {
      console.warn(
        "[api/dashboard/settings] Skipping services replace: empty services payload",
        JSON.stringify({ slug, user_id: user.id })
      );
      shouldReplaceServices = false;
    }
  }

  if (shouldReplaceServices) {
    await admin.from("services").delete().eq("business_id", savedBiz.id);

    const namedRows = services.filter((s) => String(s.name ?? "").trim());
    const usedServiceSlugs = new Set<string>();
    const servicesPayload = namedRows.map((s, index) => {
      const name = truncateTrialServiceName(String(s.name ?? ""));
      let slug = ensureServiceInsertSlug(name, String(s.service_slug ?? ""), index);
      let bump = 0;
      while (usedServiceSlugs.has(slug)) {
        bump += 1;
        slug = `${ensureServiceInsertSlug(name, String(s.service_slug ?? ""), index)}-${bump}`.slice(0, 80);
      }
      usedServiceSlugs.add(slug);
      return {
        business_id: savedBiz.id,
        name,
        description: String(s.description ?? ""),
        location_mode: String(s.location_mode ?? "online"),
        location_text: String(s.location_text ?? ""),
        price_text: String(s.price_text ?? ""),
        service_slug: slug,
      };
    });

    if (servicesPayload.length) {
      const { data } = await admin.from("services").insert(servicesPayload).select("id, service_slug");
      insertedServices = (data ?? []) as Array<{ id: number; service_slug: string }>;
    }
  } else if (shouldReplaceFaqs) {
    const { data } = await admin.from("services").select("id, service_slug").eq("business_id", savedBiz.id);
    insertedServices = (data ?? []) as Array<{ id: number; service_slug: string }>;
  }

  if (shouldReplaceFaqs) {
    await admin.from("faqs").delete().eq("business_id", savedBiz.id);

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
  }

  return NextResponse.json({ ok: true, slug: savedBiz.slug });
}
