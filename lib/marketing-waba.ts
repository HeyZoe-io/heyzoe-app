import { MARKETING_WA_PHONE_NUMBER_ID } from "@/lib/marketing-whatsapp";

let cachedWabaId: string | null = null;

function envFallbackWabaId(): string {
  return String(process.env.META_WABA_ID ?? "")
    .trim()
    .replace(/\s+/g, "");
}

/**
 * WABA that owns the HeyZoe marketing/admin WhatsApp number.
 * 1 Graph call per process (cached). Fallback: META_WABA_ID.
 */
export async function resolveMarketingWabaId(): Promise<string> {
  if (cachedWabaId) return cachedWabaId;

  const token = String(process.env.WHATSAPP_SYSTEM_TOKEN ?? "").trim();
  const phoneNumberId = MARKETING_WA_PHONE_NUMBER_ID;
  if (token && phoneNumberId) {
    try {
      const url =
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}` +
        `?fields=whatsapp_business_account`;
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        whatsapp_business_account?: { id?: unknown };
        error?: { message?: unknown };
      };
      if (!res.ok) {
        console.error("[marketing-waba] Graph lookup failed:", res.status, json?.error ?? json);
      } else {
        const id = String(json.whatsapp_business_account?.id ?? "")
          .trim()
          .replace(/\s+/g, "");
        if (id) {
          cachedWabaId = id;
          return id;
        }
      }
    } catch (e) {
      console.error("[marketing-waba] Graph lookup threw:", e);
    }
  }

  const fallback = envFallbackWabaId();
  if (fallback) {
    cachedWabaId = fallback;
    return fallback;
  }
  return "";
}
