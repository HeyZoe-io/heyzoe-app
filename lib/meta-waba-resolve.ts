import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * WhatsApp Business Account ID saved per business (Embedded Signup).
 * Falls back to META_WABA_ID env when unset (legacy).
 */
export async function fetchBusinessWabaId(admin: SupabaseClient, businessSlug: string): Promise<string> {
  const slug = String(businessSlug ?? "")
    .trim()
    .toLowerCase();
  if (!slug) return "";
  try {
    const { data, error } = await admin.from("businesses").select("waba_id").eq("slug", slug).maybeSingle();
    if (error || !data) return "";
    return String((data as { waba_id?: unknown }).waba_id ?? "")
      .trim()
      .replace(/\s+/g, "");
  } catch {
    return "";
  }
}

export function resolveMetaWabaId(dbWabaId: string, envFallback: string): string {
  const fromDb = String(dbWabaId ?? "").trim();
  if (fromDb) return fromDb;
  return String(envFallback ?? "").trim();
}
