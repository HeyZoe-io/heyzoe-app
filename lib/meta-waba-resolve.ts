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

export type MetaWabaPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
};

/**
 * Lists WhatsApp phone numbers registered on a Meta WABA via Graph API.
 *
 * @param wabaId - WhatsApp Business Account ID (not phone_number_id).
 * @param token - Meta access token (e.g. System User token passed by caller).
 * @returns Normalized entries from `data[]` (`id` = phone_number_id).
 * @throws If `wabaId` or `token` is missing/empty.
 * @throws If Graph API responds with status >= 400.
 *
 * Typical use: PARTNER_ADDED webhook self-healing — after a customer WABA is
 * shared, list numbers on that WABA to upsert `whatsapp_channels` when Meta
 * did not send `phone_number_id` in the webhook payload.
 */
export async function fetchPhoneNumbersForWaba(
  wabaId: string,
  token: string
): Promise<MetaWabaPhoneNumber[]> {
  const waba = String(wabaId ?? "").trim().replace(/\s+/g, "");
  const accessToken = String(token ?? "").trim();
  if (!waba) throw new Error("[fetchPhoneNumbersForWaba] missing wabaId");
  if (!accessToken) throw new Error("[fetchPhoneNumbersForWaba] missing token");

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(waba)}/phone_numbers`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    console.error("[fetchPhoneNumbersForWaba] Meta Graph API error:", {
      status: res.status,
      wabaId: waba,
      body: bodyText,
    });
    throw new Error(`[fetchPhoneNumbersForWaba] Meta Graph API ${res.status}: ${bodyText || res.statusText}`);
  }

  let json: unknown = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }

  const list = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data: unknown[] }).data ?? [])
    : [];

  return list
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? "").trim();
      if (!id) return null;
      const display = String(r.display_phone_number ?? "").trim();
      const verified = String(r.verified_name ?? "").trim();
      return {
        id,
        ...(display ? { display_phone_number: display } : {}),
        ...(verified ? { verified_name: verified } : {}),
      } satisfies MetaWabaPhoneNumber;
    })
    .filter((row): row is MetaWabaPhoneNumber => row !== null);
}
