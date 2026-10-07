import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type BusinessInfoRow = {
  name: string | null;
  cta_text: string | null;
  cta_link: string | null;
  service_name: string | null;
  address: string | null;
  trial_class: string | null;
};

/**
 * שליפת שורת עסק לפי slug מטבלת "Business Info".
 * (הוסר unstable_cache — ב-API Routes + Turbopack זה עלול לזרוק ולשבור את /api/business.)
 */
export async function getCachedBusinessBySlug(slug: string): Promise<BusinessInfoRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("Business Info")
    .select("name, cta_text, cta_link, service_name, address, trial_class")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase (business):", error.message, { slug });
    return null;
  }

  return data as BusinessInfoRow | null;
}
