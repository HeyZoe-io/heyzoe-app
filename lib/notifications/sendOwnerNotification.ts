import { resolveMetaAccessToken } from "@/lib/whatsapp";

export type OwnerTemplateComponent = {
  type: "body";
  parameters: Array<{ type: "text"; text: string }>;
};

function resolveZoeMasterPhoneNumberId(): string {
  return (
    process.env.ZOEMASTER_PHONE_NUMBER_ID?.trim() ||
    process.env.MARKETING_WA_PHONE_NUMBER_ID?.trim() ||
    "1179786855208358"
  );
}

/**
 * שולח הודעת template לבעל העסק ממספר זואי הראשי (ZOEMASTER_PHONE_NUMBER_ID).
 */
export async function sendOwnerNotification(input: {
  ownerPhone: string;
  templateName: string;
  languageCode?: string;
  components?: OwnerTemplateComponent[];
}): Promise<{ ok: boolean; error?: string }> {
  const token = resolveMetaAccessToken();
  if (!token) {
    return { ok: false, error: "missing_meta_token" };
  }

  const phoneNumberId = resolveZoeMasterPhoneNumberId();
  const to = String(input.ownerPhone ?? "").replace(/\D/g, "");
  if (!to) return { ok: false, error: "missing_owner_phone" };

  const templateName = String(input.templateName ?? "").trim();
  if (!templateName) return { ok: false, error: "missing_template" };

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: input.languageCode?.trim() || "he" },
      ...(input.components?.length ? { components: input.components } : {}),
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[sendOwnerNotification] Meta error:", res.status, errText);
      return { ok: false, error: errText || `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sendOwnerNotification] failed:", msg);
    return { ok: false, error: msg };
  }
}
