import { HEYZOE_SF_REGISTERED } from "@/lib/analytics";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import type { CrmTrialRegistrationContext } from "@/lib/crm/types";
import { resolveServiceNameForSession } from "@/lib/notifications/owner-email-context";
import type { OfferKind } from "@/lib/sales-flow";
import { buildWaSessionId, contactPhoneLookupVariants } from "@/lib/phone-normalize";

export function buildTrialRegisteredContactPatch(atIso: string): Record<string, unknown> {
  return {
    trial_registered: true,
    trial_registered_at: atIso,
    session_phase: "registered",
    flow_step: 0,
    human_requested_at: null,
    wa_next_followup_at: null,
    wa_no_response_due_at: null,
    wa_followup_stage: 3,
    followup_sent: true,
  };
}

async function resolveRegistrationContext(input: {
  admin: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  sessionId: string | null;
}): Promise<CrmTrialRegistrationContext> {
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  const { data: rows } = await input.admin
    .from("contacts")
    .select("sf_requested_date, sf_requested_time, last_contact_at")
    .eq("business_id", input.businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [input.phone]);

  const list = (rows ?? []) as Array<{
    sf_requested_date?: string | null;
    sf_requested_time?: string | null;
    last_contact_at?: string | null;
  }>;
  list.sort((a, b) => {
    const ta = a.last_contact_at ? Date.parse(a.last_contact_at) : 0;
    const tb = b.last_contact_at ? Date.parse(b.last_contact_at) : 0;
    return tb - ta;
  });
  const row = list[0];
  const requestedDate = String(row?.sf_requested_date ?? "").trim() || null;
  const requestedTime = String(row?.sf_requested_time ?? "").trim() || null;

  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  const serviceName =
    slug && sessionId
      ? await resolveServiceNameForSession({
          businessSlug: slug,
          sessionId,
          businessId: input.businessId,
        })
      : "";

  let offerKind: OfferKind = "trial";
  if (slug && serviceName.trim()) {
    const pack = await getBusinessKnowledgePack(slug);
    const match = pack?.openingServices?.find((s) => s.name.trim() === serviceName.trim());
    if (match?.offer_kind) offerKind = match.offer_kind;
  }

  return {
    serviceName: serviceName.trim() || null,
    offerKind,
    requestedDate,
    requestedTime,
    courseSchedulePhrase: null,
  };
}

/** סימון ידני מדשבורד — עוצר פולואפים, נספר בהמרות, CRM + התראות בעלים */
export async function markContactTrialRegisteredManually(input: {
  admin: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName?: string | null;
}): Promise<{ ok: true; trial_registered_at: string } | { ok: false; error: string }> {
  const businessId = Number(input.businessId);
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  if (!businessId || !phoneVariants.length) {
    return { ok: false, error: "invalid_phone" };
  }

  const nowIso = new Date().toISOString();
  const patch = buildTrialRegisteredContactPatch(nowIso);

  const { data: updated, error } = await input.admin
    .from("contacts")
    .update(patch)
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .select("id");

  if (error) {
    console.error("[trial-registered-manual] update failed:", error.message);
    return { ok: false, error: "update_failed" };
  }
  if (!updated?.length) {
    return { ok: false, error: "contact_not_found" };
  }

  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const { data: channel } = await input.admin
    .from("whatsapp_channels")
    .select("phone_number_id")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  const phoneNumberId = String((channel as { phone_number_id?: string } | null)?.phone_number_id ?? "").trim();
  const sessionId = phoneNumberId ? buildWaSessionId(phoneNumberId, input.phone) : null;

  const { logMessage } = await import("@/lib/analytics");
  await logMessage({
    business_slug: slug,
    role: "event",
    content: HEYZOE_SF_REGISTERED,
    model_used: "sf_registered_manual",
    session_id: sessionId,
  });

  const registration = await resolveRegistrationContext({
    admin: input.admin,
    businessId,
    businessSlug: slug,
    phone: input.phone,
    sessionId,
  });

  const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
  void dispatchCrmEvent({
    businessId,
    leadPhone: input.phone,
    kind: "trial_registered",
    fullName: input.fullName,
    eventAtIso: nowIso,
    registration,
  });

  try {
    const pack = await getBusinessKnowledgePack(slug);
    const { triggerLeadRegisteredNotification } = await import("@/lib/notifications/triggers");
    if (sessionId) {
      void triggerLeadRegisteredNotification({
        businessId,
        leadPhone: input.phone,
        businessSlug: slug,
        sessionId,
        registeredAtIso: nowIso,
        scheduleDirectRegistration: pack?.scheduleDirectRegistration !== false,
        requestedDate: registration.requestedDate,
        requestedTime: registration.requestedTime,
      });
    }
  } catch (e) {
    console.warn("[trial-registered-manual] owner notification failed:", e);
  }

  return { ok: true, trial_registered_at: nowIso };
}
