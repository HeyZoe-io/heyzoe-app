import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  publicBusinessDataFromRow,
  type PublicBusinessData,
} from "@/lib/public-business-response";

export type { PublicBusinessData };

export async function getPublicBusinessBySlug(slug: string): Promise<PublicBusinessData | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (
    !normalizedSlug ||
    normalizedSlug.includes(".") ||
    normalizedSlug === "robots.txt" ||
    normalizedSlug === "favicon.ico" ||
    normalizedSlug === "sitemap.xml"
  ) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { data: business, error } = await admin
    .from("businesses")
    .select(
      "id, slug, name, niche, logo_url, welcome_message, bot_name, primary_color, secondary_color, cta_text, cta_link, social_links"
    )
    .eq("slug", normalizedSlug)
    .maybeSingle();

  if (error) {
    console.error("[getPublicBusinessBySlug]", error.message, { slug: normalizedSlug });
    return null;
  }
  if (!business) return null;

  const { data: services, error: servicesError } = await admin
    .from("services")
    .select("name, location_text")
    .eq("business_id", business.id)
    .order("id", { ascending: true })
    .limit(1);

  if (servicesError) {
    console.error("[getPublicBusinessBySlug] services", servicesError.message, { slug: normalizedSlug });
  }

  const firstService = services?.[0];
  return publicBusinessDataFromRow({
    slug: business.slug,
    name: business.name,
    niche: business.niche,
    logo_url: business.logo_url,
    welcome_message: business.welcome_message,
    bot_name: business.bot_name,
    primary_color: business.primary_color,
    secondary_color: business.secondary_color,
    cta_text: business.cta_text,
    cta_link: business.cta_link,
    social_links: business.social_links,
    service_name: firstService?.name,
    service_location: firstService?.location_text,
  });
}
