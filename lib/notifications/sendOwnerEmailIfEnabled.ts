import { sendEmail, type EmailTemplateResult } from "@/lib/email";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getNotificationSettings } from "@/lib/notifications/getNotificationSettings";
import type { OwnerEmailSettingKey } from "@/lib/notifications/types";

export async function sendOwnerEmailIfEnabled(input: {
  businessId: number;
  settingKey: OwnerEmailSettingKey;
  build: (ctx: { businessName: string; email: string }) => EmailTemplateResult;
}): Promise<void> {
  const businessId = Number(input.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return;

  const settings = await getNotificationSettings(businessId);
  if (!settings[input.settingKey]) return;

  const admin = createSupabaseAdminClient();
  const { data: biz, error } = await admin
    .from("businesses")
    .select("name, email")
    .eq("id", businessId)
    .maybeSingle();

  if (error || !biz) {
    console.warn("[sendOwnerEmailIfEnabled] business lookup failed:", error?.message, businessId);
    return;
  }

  const email = String((biz as { email?: string }).email ?? "").trim();
  if (!email) {
    console.warn("[sendOwnerEmailIfEnabled] missing businesses.email:", businessId, input.settingKey);
    return;
  }

  const businessName = String((biz as { name?: string }).name ?? "").trim() || "העסק שלך";
  const tpl = input.build({ businessName, email });
  const result = await sendEmail({ to: email, subject: tpl.subject, htmlContent: tpl.htmlContent });

  if (!result.ok) {
    console.warn("[sendOwnerEmailIfEnabled] send failed:", input.settingKey, businessId, result.error);
  }
}
