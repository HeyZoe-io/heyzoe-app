import { HEYZOE_SF_REGISTERED, logMessage } from "@/lib/analytics";
import type { CrmTrialRegistrationContext } from "@/lib/crm/types";
import { buildTrialRegisteredContactPatch } from "@/lib/trial-registered-manual";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  sendTrialRegisteredWhatsAppReplyIfInWindow,
} from "@/lib/trial-registered-wa-reply";

export type PlandoRegisteredWebhookBody = {
  phone?: unknown;
  full_name?: unknown;
  name?: unknown;
  business_slug?: unknown;
  plando_contact_id?: unknown;
  contact_id?: unknown;
  plando_record_id?: unknown;
  record_id?: unknown;
};

export type PlandoRegisteredResult =
  | { ok: true; already: true }
  | {
      ok: true;
      trial_registered_at: string;
      whatsapp:
        | "sent"
        | "no_channel"
        | "outside_24h_window"
        | "no_user_session"
        | "send_failed";
      contact_created: boolean;
    }
  | { ok: false; error: string };

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

async function resolveRegistrationContext(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  sessionId: string | null;
}): Promise<CrmTrialRegistrationContext> {
  const { resolveServiceNameForSession } = await import("@/lib/notifications/owner-email-context");
  const { getBusinessKnowledgePack } = await import("@/lib/business-context");
  const variants = contactPhoneLookupVariants(input.phone);
  const { data: rows } = await input.admin
    .from("contacts")
    .select("sf_requested_date, sf_requested_time, last_contact_at")
    .eq("business_id", input.businessId)
    .in("phone", variants.length ? variants : [input.phone]);

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

  let offerKind: import("@/lib/sales-flow").OfferKind = "trial";
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

/**
 * ליד הפך ל«לקוח/תלמיד» בפלנדו → דורס סטטוס בזואי (כולל «לא רלוונטי»), עוצר פולואפים,
 * הודעת אישור (אם בחלון 24ש'). פלנדו הוא מקור האמת לרישום — לא שולח חזרה ל-CRM.
 */
export async function handlePlandoCustomerRegistered(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  body: PlandoRegisteredWebhookBody;
}): Promise<PlandoRegisteredResult> {
  const phoneNorm = normalizePhone(input.body.phone);
  const businessSlug = String(input.body.business_slug ?? "").trim().toLowerCase();
  const fullName =
    String(input.body.full_name ?? input.body.name ?? "").trim() || null;
  const plandoContactId = String(
    input.body.plando_contact_id ?? input.body.contact_id ?? ""
  ).trim();
  const plandoRecordId = String(
    input.body.plando_record_id ?? input.body.record_id ?? ""
  ).trim();

  if (!phoneNorm) return { ok: false, error: "invalid_phone" };
  if (!businessSlug) return { ok: false, error: "missing_business_slug" };

  const { data: business, error: bizErr } = await input.admin
    .from("businesses")
    .select("id, slug, plan")
    .eq("slug", businessSlug)
    .maybeSingle();

  if (bizErr) {
    console.error("[leads/plando-registered] business lookup failed:", bizErr.message);
    return { ok: false, error: "business_lookup_failed" };
  }
  if (!business?.id) return { ok: false, error: "business_not_found" };

  const businessId = Number(business.id);
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return { ok: false, error: "business_lookup_failed" };
  }

  const phoneVariants = contactPhoneLookupVariants(phoneNorm);
  const { data: existingRows, error: existingErr } = await input.admin
    .from("contacts")
    .select(
      "id, phone, full_name, trial_registered, session_phase, opted_out, not_relevant_at, instagram_follow_prompt_sent"
    )
    .eq("business_id", businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [phoneNorm])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (existingErr) {
    console.error("[leads/plando-registered] contact lookup failed:", existingErr.message);
    return { ok: false, error: "contact_lookup_failed" };
  }

  const existing = existingRows?.[0] as {
    phone?: string;
    full_name?: string | null;
    trial_registered?: boolean | null;
    session_phase?: string | null;
    opted_out?: boolean | null;
    not_relevant_at?: string | null;
    instagram_follow_prompt_sent?: boolean | null;
  } | undefined;

  const alreadyRegistered =
    existing?.trial_registered === true ||
    String(existing?.session_phase ?? "").trim() === "registered";
  if (alreadyRegistered) {
    return { ok: true, already: true };
  }

  const hadNotRelevant = Boolean(existing?.not_relevant_at);
  const hadOptedOut = existing?.opted_out === true;

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    ...buildTrialRegisteredContactPatch(nowIso),
    not_relevant_at: null,
    not_relevant_reason: "",
    wa_no_response_at: null,
    updated_at: nowIso,
  };
  if (fullName) patch.full_name = fullName;
  if (plandoContactId) patch.plando_contact_id = plandoContactId;
  if (plandoRecordId) patch.plando_record_id = plandoRecordId;

  let contactCreated = false;
  const canonicalPhone = String(existing?.phone ?? phoneNorm);

  if (!existing) {
    const { error: insertErr } = await input.admin.from("contacts").insert({
      business_id: businessId,
      phone: phoneNorm,
      full_name: fullName,
      source: "plando_customer",
      ...patch,
    });
    if (insertErr) {
      console.error("[leads/plando-registered] contact insert failed:", insertErr.message);
      return { ok: false, error: "contact_upsert_failed" };
    }
    contactCreated = true;
  } else {
    const { data: updated, error: updateErr } = await input.admin
      .from("contacts")
      .update(patch)
      .eq("business_id", businessId)
      .in("phone", phoneVariants.length ? phoneVariants : [phoneNorm])
      .select("id");
    if (updateErr) {
      console.error("[leads/plando-registered] contact update failed:", updateErr.message);
      return { ok: false, error: "contact_upsert_failed" };
    }
    if (!updated?.length) return { ok: false, error: "contact_not_found" };
  }

  if (hadNotRelevant || hadOptedOut) {
    console.info("[leads/plando-registered] plando overrode zoe status", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      had_not_relevant: hadNotRelevant,
      had_opted_out: hadOptedOut,
    });
  }

  const { data: channel } = await input.admin
    .from("whatsapp_channels")
    .select("phone_number_id")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  const phoneNumberId = String((channel as { phone_number_id?: string } | null)?.phone_number_id ?? "").trim();
  const sessionId = phoneNumberId ? buildWaSessionId(phoneNumberId, canonicalPhone) : null;

  await logMessage({
    business_slug: businessSlug,
    role: "event",
    content: HEYZOE_SF_REGISTERED,
    model_used: "sf_registered_plando_webhook",
    session_id: sessionId,
  });

  const waResult = await sendTrialRegisteredWhatsAppReplyIfInWindow({
    admin: input.admin,
    businessId,
    businessSlug,
    phone: canonicalPhone,
    instagramFollowPromptSent: existing?.instagram_follow_prompt_sent === true,
    businessPlan: (business as { plan?: unknown }).plan,
  });

  try {
    const registration = await resolveRegistrationContext({
      admin: input.admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      sessionId,
    });
    const { triggerLeadRegisteredNotification } = await import("@/lib/notifications/triggers");
    if (sessionId) {
      const { getBusinessKnowledgePack } = await import("@/lib/business-context");
      const pack = await getBusinessKnowledgePack(businessSlug);
      void triggerLeadRegisteredNotification({
        businessId,
        leadPhone: canonicalPhone,
        businessSlug,
        sessionId,
        registeredAtIso: nowIso,
        scheduleDirectRegistration: pack?.scheduleDirectRegistration !== false,
        requestedDate: registration.requestedDate,
        requestedTime: registration.requestedTime,
      });
    }
  } catch (e) {
    console.warn("[leads/plando-registered] owner notification failed:", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const whatsapp = waResult.sent ? "sent" : waResult.reason;
  if (!waResult.sent) {
    console.info("[leads/plando-registered] whatsapp skipped", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      reason: waResult.reason,
    });
  }

  return {
    ok: true,
    trial_registered_at: nowIso,
    whatsapp,
    contact_created: contactCreated,
  };
}
