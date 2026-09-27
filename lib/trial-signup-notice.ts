import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";

/** Who already told this person they are registered for a trial. */
export type TrialSignupNotice = "zoe" | "template";

export const ZOE_REGISTRATION_CONFIRM_MODEL = "sales_flow_after_trial_registered";

export function trialPurchaseTemplateBlockedByZoe(notice: TrialSignupNotice | null): boolean {
  return notice === "zoe";
}

export function zoeRegistrationConfirmBlockedByTrialTemplate(
  notice: TrialSignupNotice | null
): boolean {
  return notice === "template";
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

function phoneVariants(phone: string): string[] {
  const variants = contactPhoneLookupVariants(phone);
  return variants.length ? variants : [phone];
}

export async function loadTrialSignupNotice(
  admin: Admin,
  businessId: number,
  phone: string
): Promise<TrialSignupNotice | null> {
  const { data, error } = await admin
    .from("contacts")
    .select("trial_signup_notice")
    .eq("business_id", businessId)
    .in("phone", phoneVariants(phone))
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[trial-signup-notice] load failed:", error.message);
    return null;
  }
  const raw = String((data?.[0] as { trial_signup_notice?: unknown } | undefined)?.trial_signup_notice ?? "")
    .trim()
    .toLowerCase();
  if (raw === "zoe" || raw === "template") return raw;
  return null;
}

/** First notice wins. A later channel does not overwrite. */
export async function stampTrialSignupNotice(
  admin: Admin,
  businessId: number,
  phone: string,
  notice: TrialSignupNotice
): Promise<void> {
  const { error } = await admin
    .from("contacts")
    .update({ trial_signup_notice: notice })
    .eq("business_id", businessId)
    .in("phone", phoneVariants(phone))
    .is("trial_signup_notice", null);

  if (error) {
    console.error("[trial-signup-notice] stamp failed:", error.message);
  }
}

/** Confirmations sent before the contact column existed. */
export async function sessionHasZoeRegistrationConfirm(
  admin: Admin,
  businessSlug: string,
  sessionId: string | null
): Promise<boolean> {
  const slug = businessSlug.trim().toLowerCase();
  const session = String(sessionId ?? "").trim();
  if (!slug || !session) return false;
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("business_slug", slug)
    .eq("session_id", session)
    .eq("model_used", ZOE_REGISTRATION_CONFIRM_MODEL)
    .limit(1);
  if (error) {
    console.error("[trial-signup-notice] message lookup failed:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
