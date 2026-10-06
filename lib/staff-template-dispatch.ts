/**
 * Immediate Meta send for staff recipients (B2/B5).
 * Skips customer opt-out, contacts lookup, and Conversations logMessage.
 */
import { fetchArboxGeneralNotesText } from "@/lib/leads/arbox-general-notes";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import {
  templateBodyUsesSlot,
  templateSendPayload,
  trainerHeadsUpTemplateParamValues,
} from "@/lib/template-send-params";
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
  clientFullName?: string | null;
  className?: string | null;
  classTime?: string | null;
  expiryDateYmd?: string | null;
  classDateYmd?: string | null;
  /** When the approved body includes {{4}}, one Arbox notes GET for this user. */
  arboxApiKey?: string | null;
  arboxUserId?: number | null;
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
  let clientGeneralNotes: string | undefined;
  if (
    templateBodyUsesSlot(input.triggerType, storedComponents, "client_general_notes")
  ) {
    const apiKey = String(input.arboxApiKey ?? "").trim();
    const userId = Math.trunc(Number(input.arboxUserId));
    if (apiKey && Number.isFinite(userId) && userId > 0) {
      clientGeneralNotes = await fetchArboxGeneralNotesText({ apiKey, userId });
    }
  }
  if (input.triggerType === "trainer_trial_heads_up") {
    const decided = trainerHeadsUpTemplateParamValues({
      storedComponents,
      className: input.className,
      classTime: input.classTime,
      clientFullName: input.clientFullName,
      clientGeneralNotes,
      classDateYmd: input.classDateYmd,
    });
    if (!decided.ok) {
      console.error("[staff-template-dispatch] trainer param skip", {
        businessId: input.businessId,
        reason: decided.reason,
        varCount: decided.varCount,
      });
      return "gated";
    }
    if (decided.values.length === 1) {
      console.info("[staff-template-dispatch] trainer hold", {
        businessId: input.businessId,
        reason: "trainer_template_pending",
      });
      return "gated";
    }
  }
  const { sendComponents } = templateSendPayload({
    triggerType: input.triggerType,
    storedComponents,
    firstName: input.firstName,
    clientFullName: input.clientFullName,
    clientGeneralNotes,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    className: input.className,
    classTime: input.classTime,
    classDateYmd: input.classDateYmd,
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
    return templateFailureDispatch(sendResult.error);
  }
  return "sent";
}
