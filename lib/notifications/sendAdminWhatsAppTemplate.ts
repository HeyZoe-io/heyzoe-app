import { resolveMetaAccessToken } from "@/lib/whatsapp";
import { MARKETING_WA_PHONE_NUMBER_ID } from "@/lib/marketing-whatsapp";

export async function sendAdminWhatsAppTemplate(input: {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParams: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const token = resolveMetaAccessToken();
  if (!token) {
    return { ok: false, error: "missing_meta_token" };
  }

  const phoneNumberId = MARKETING_WA_PHONE_NUMBER_ID;
  const to = String(input.to ?? "").replace(/\D/g, "");
  if (!to) return { ok: false, error: "missing_recipient" };

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
      components: [
        {
          type: "body",
          parameters: input.bodyParams.map((t) => ({ type: "text", text: t })),
        },
      ],
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
      console.error("[sendAdminWhatsAppTemplate] Meta error:", res.status, errText);
      return { ok: false, error: errText || `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sendAdminWhatsAppTemplate] failed:", msg);
    return { ok: false, error: msg };
  }
}
