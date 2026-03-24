import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseAnonKey, resolveSupabaseUrl } from "@/lib/server-env";

export type BusinessInfoRow = {
  name: string | null;
  cta_text: string | null;
  cta_link: string | null;
  service_name: string | null;
  address: string | null;
  trial_class: string | null;
};

/**
 * שליפת שורת עסק לפי slug מ-Supabase.
 * (הוסר unstable_cache — ב-API Routes + Turbopack זה עלול לזרוק ולשבור את /api/business.)
 */
export async function getCachedBusinessBySlug(slug: string): Promise<BusinessInfoRow | null> {
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase
    .from("Business Info")
    .select("name, cta_text, cta_link, service_name, address, trial_class")
    .eq("slug", slug)
    .single();

  if (error) {
    console.error("Supabase (business):", error.message, { slug });
    return null;
  }

  return data as BusinessInfoRow;
}
