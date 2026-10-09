let cachedWabaId: string | null = null;

function envWabaId(): string {
  return String(process.env.META_WABA_ID ?? "")
    .trim()
    .replace(/\s+/g, "");
}

/**
 * WABA that owns the HeyZoe marketing/admin WhatsApp number.
 * META_WABA_ID only. Graph has no whatsapp_business_account field on the phone node.
 */
export async function resolveMarketingWabaId(): Promise<string> {
  if (cachedWabaId) return cachedWabaId;
  const id = envWabaId();
  if (id) cachedWabaId = id;
  return id;
}
