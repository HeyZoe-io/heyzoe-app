import { createHash } from "crypto";

const META_CAPI_GRAPH_VERSION = "v21.0";

function resolveMetaCapiPixelId(): string {
  return process.env.META_MARKETING_PIXEL_ID?.trim() ?? "";
}

function resolveMetaCapiAccessToken(): string {
  return process.env.META_MARKETING_CAPI_ACCESS_TOKEN?.trim() ?? "";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input.trim().toLowerCase(), "utf8").digest("hex");
}

/**
 * שולח אירוע ל-Meta Conversions API של HeyZoe עצמה (META_MARKETING_PIXEL_ID) — לא קשור
 * לפיקסלים הפר-עסקיים (businesses.facebook_pixel_id / conversions_api_token).
 * action_source ברירת מחדל "business_messaging" (וואטסאפ שיווקי); אפשר גם "website"
 * (fbp/fbc מהאתר) עבור אירועי InitiateCheckout/Purchase שמגיעים דרך עמוד הנחיתה/onboarding.
 */
export async function sendMetaCapiEvent(input: {
  eventName: "LeadSubmitted" | "Purchase" | "InitiateCheckout";
  actionSource?: "business_messaging" | "website";
  phone?: string | null;
  email?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ctwaClid?: string | null;
  externalId?: string | number | null;
  value?: number;
  currency?: string;
  eventSourceUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const pixelId = resolveMetaCapiPixelId();
  const accessToken = resolveMetaCapiAccessToken();
  if (!pixelId || !accessToken) {
    return { ok: false, error: "missing_meta_capi_credentials" };
  }

  const actionSource = input.actionSource ?? "business_messaging";

  const phoneDigits = String(input.phone ?? "").replace(/\D/g, "");
  if (actionSource === "business_messaging" && !phoneDigits) {
    return { ok: false, error: "missing_phone" };
  }

  const userData: Record<string, unknown> = {};
  if (phoneDigits) userData.ph = [sha256Hex(phoneDigits)];
  const email = String(input.email ?? "").trim();
  if (email) userData.em = [sha256Hex(email)];
  const ctwaClid = String(input.ctwaClid ?? "").trim();
  if (ctwaClid) userData.ctwa_clid = ctwaClid;
  const externalId = input.externalId != null ? String(input.externalId).trim() : "";
  if (externalId) userData.external_id = externalId;
  const fbp = String(input.fbp ?? "").trim();
  if (fbp) userData.fbp = fbp;
  const fbc = String(input.fbc ?? "").trim();
  if (fbc) userData.fbc = fbc;

  const customData: Record<string, unknown> = {};
  if (typeof input.value === "number" && Number.isFinite(input.value) && input.value > 0) {
    customData.value = input.value;
    customData.currency = input.currency?.trim() || "ILS";
  }

  const eventData: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: actionSource,
    user_data: userData,
    ...(Object.keys(customData).length ? { custom_data: customData } : {}),
  };
  if (actionSource === "business_messaging") {
    eventData.messaging_channel = "whatsapp";
  } else if (input.eventSourceUrl) {
    eventData.event_source_url = input.eventSourceUrl;
  }

  const body = { data: [eventData] };

  try {
    const url = `https://graph.facebook.com/${META_CAPI_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[meta-capi] send failed:", res.status, errText);
      return { ok: false, error: errText || `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meta-capi] send threw:", msg);
    return { ok: false, error: msg };
  }
}
