import { createClient } from "@supabase/supabase-js";
import {
  resolveSupabaseAnonKey,
  resolveSupabaseUrl,
} from "@/lib/server-env";

export type PublicBusinessData = {
  slug: string;
  name: string;
  service_name: string;
  address: string;
  trial_class: string;
  cta_text: string | null;
  cta_link: string | null;
  welcome_message: string;
  bot_name: string;
  primary_color: string;
  secondary_color: string;
};

export async function getPublicBusinessBySlug(slug: string): Promise<PublicBusinessData | null> {
  const supabase = createClient(resolveSupabaseUrl(), resolveSupabaseAnonKey());

  const { data: business, error } = await supabase
    .from("businesses")
    .select("id, slug, name, niche, welcome_message, bot_name, primary_color, secondary_color, cta_text, cta_link")
    .eq("slug", slug)
    .single();

  if (error || !business) return null;

  const { data: services } = await supabase
    .from("services")
    .select("name, location_text")
    .eq("business_id", business.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const firstService = services?.[0];
  return {
    slug: String(business.slug),
    name: String(business.name ?? ""),
    service_name: String(firstService?.name ?? business.niche ?? business.name ?? ""),
    address: String(firstService?.location_text ?? ""),
    trial_class: "",
    cta_text: (business.cta_text as string | null) ?? null,
    cta_link: (business.cta_link as string | null) ?? null,
    welcome_message: String(business.welcome_message ?? "שלום, כאן זואי. איך אפשר לעזור?"),
    bot_name: String(business.bot_name ?? "זואי"),
    primary_color: String(business.primary_color ?? "#ff85cf"),
    secondary_color: String(business.secondary_color ?? "#bc74e9"),
  };
}
