/**
 * Immediate Meta send for staff recipients (B2/B5).
 * Skips customer opt-out, contacts lookup, and Conversations logMessage.
 */
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export type StaffTemplateDispatch = "sent" | "gated" | "send_failed";

export async function dispatchStaffTemplateImmediate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
  templateName: string;
  triggerType: string;
  firstName?: string | null;
  className?: string | null;
  classTime?: string | null;
  expiryDateYmd?: string | null;
}): Promise<StaffTemplateDispatch> {
  const templateName = String(input.templateName ?? "").trim();
  if (!templateName) return "gated";

  const channel = await resolveSendChannelForContact(
    input.admin,
    input.businessId,
    input.phone
  );
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return "gated";

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id, name").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language, components")
      .eq("business_id", input.businessId)
      .eq("name", templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
  ]);

  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!wabaId || !approvedTpl?.id) return "gated";

  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents } = templateSendPayload({
    triggerType: input.triggerType,
    storedComponents,
    firstName: input.firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    className: input.className,
    classTime: input.classTime,
    expiryDateYmd: input.expiryDateYmd,
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    recipientKind: "staff",
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[staff-template-dispatch] template send failed:", sendResult.error, {
      businessId: input.businessId,
      triggerType: input.triggerType,
    });
    return "send_failed";
  }
  return "sent";
}
