import { lookupBusinessIdByPhoneNumberId } from "@/lib/contact-alert-mute";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** Graph error JSON becomes `code: message`. Plain text is kept as-is. */
export function formatMetaSendError(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "send_failed";
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: number | string; message?: string; error_data?: { details?: string } };
    };
    const code = parsed.error?.code;
    const message = String(parsed.error?.error_data?.details || parsed.error?.message || "").trim();
    if (code != null && message) return `${code}: ${message}`.slice(0, 500);
    if (code != null) return String(code);
  } catch {
    /* plain text */
  }
  return text.slice(0, 500);
}

export async function recordTemplateSendFailure(input: {
  phoneNumberId: string;
  phone: string;
  templateName: string;
  triggerId?: string | null;
  metaError: string;
  raw: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const businessId = await lookupBusinessIdByPhoneNumberId(admin, input.phoneNumberId).catch(() => null);
  const code = input.metaError.split(":")[0]?.trim() ?? "";
  const message = input.metaError.includes(":")
    ? input.metaError.slice(input.metaError.indexOf(":") + 1).trim()
    : input.metaError;
  const { error } = await admin.from("template_send_failures").insert({
    business_id: businessId,
    phone: input.phone,
    template_name: input.templateName,
    trigger_id: input.triggerId || null,
    meta_code: code.slice(0, 40),
    meta_message: message.slice(0, 500),
    raw_error: input.raw.slice(0, 1000),
  });
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    console.error("[template-send] failure log insert failed", error.message);
  }
  const { alertBusinessBlockingErrors, shouldAlertForSendFailure } = await import("@/lib/wa-blocking-error-alert");
  if (shouldAlertForSendFailure(input.phoneNumberId, businessId, code)) {
    await alertBusinessBlockingErrors(
      [{ businessId: Number(businessId), errorCode: Number(code), detail: input.templateName, source: "send_api" }],
      { admin }
    );
  }
}
