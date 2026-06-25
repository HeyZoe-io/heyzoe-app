import { buildWaSessionId, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** 26 שעות אחרי הודעת הליד האחרונה — ללא «נרשמתי» (trial_registered) */
export const WA_NO_RESPONSE_AFTER_MS = 26 * 60 * 60 * 1000;

export type WaNoResponseContactGate = {
  opted_out?: boolean | null;
  not_relevant_at?: string | null;
  human_requested_at?: string | null;
  trial_registered?: boolean | null;
  session_phase?: string | null;
};

export function waNoResponseEligible(contact: WaNoResponseContactGate): boolean {
  if (contact.opted_out === true) return false;
  if (contact.not_relevant_at) return false;
  if (contact.human_requested_at) return false;
  if (contact.trial_registered === true) return false;
  if (String(contact.session_phase ?? "").trim() === "registered") return false;
  return true;
}

export function isIdleAfterLastUserMessage(
  lastUserAtIso: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const raw = String(lastUserAtIso ?? "").trim();
  if (!raw) return false;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) && nowMs - t >= WA_NO_RESPONSE_AFTER_MS;
}

export async function fetchLastUserMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<string | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data, error } = await input.admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", input.business_slug.trim().toLowerCase())
    .in("session_id", sessionIds)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[wa-no-response] fetchLastUserMessageAt:", error.message);
    return null;
  }
  const at = data?.created_at ? String(data.created_at) : "";
  return at || null;
}

export function buildNoResponseContactPatch(atIso: string): Record<string, unknown> {
  return {
    wa_no_response_at: atIso,
    wa_next_followup_at: null,
    wa_no_response_due_at: null,
    wa_followup_stage: 3,
    followup_sent: true,
  };
}

/** איפוס «ללא מענה» — מחזיר את הליד לפעיל ומאפשר חידוש פולואפים. */
export function buildNoResponseReactivationPatch(): Record<string, unknown> {
  return {
    wa_no_response_at: null,
    wa_followup_stage: 0,
    wa_followup_1_sent_at: null,
    wa_followup_2_sent_at: null,
    wa_followup_3_sent_at: null,
    followup_sent: false,
  };
}

/** סימון ידני מדשבורד — עוצר פולואפים, ללא הודעה לליד */
export async function markContactNoResponseManually(input: {
  admin: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName?: string | null;
}): Promise<{ ok: true; wa_no_response_at: string; already?: boolean } | { ok: false; error: string }> {
  const businessId = Number(input.businessId);
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  if (!businessId || !phoneVariants.length) {
    return { ok: false, error: "invalid_phone" };
  }

  const { data: existing } = await input.admin
    .from("contacts")
    .select("wa_no_response_at, full_name")
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((existing as { wa_no_response_at?: string | null } | null)?.wa_no_response_at) {
    return {
      ok: true,
      wa_no_response_at: String((existing as { wa_no_response_at?: string | null }).wa_no_response_at),
      already: true,
    };
  }

  const nowIso = new Date().toISOString();
  const patch = buildNoResponseContactPatch(nowIso);

  const { data: updated, error } = await input.admin
    .from("contacts")
    .update(patch)
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .select("id");

  if (error) {
    console.error("[wa-no-response] manual mark failed:", error.message);
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
    content: "[heyzoe:no_response:manual]",
    model_used: "no_response_manual",
    session_id: sessionId,
  });

  const fullName =
    String(input.fullName ?? "").trim() ||
    String((existing as { full_name?: string | null } | null)?.full_name ?? "").trim() ||
    null;

  const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
  void dispatchCrmEvent({
    businessId,
    leadPhone: input.phone,
    kind: "no_response",
    fullName,
    eventAtIso: nowIso,
  }).catch((e) => console.error("[wa-no-response] manual CRM dispatch failed:", e));

  return { ok: true, wa_no_response_at: nowIso };
}

/** הפעלה מחדש של ליד שסומן «ללא מענה» אחרי הודעה נכנסת חדשה. */
export async function reactivateNoResponseLead(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  sessionId: string;
  contactId?: string | number | null;
}): Promise<boolean> {
  const businessId = Number(input.businessId);
  const phone = String(input.phone ?? "").trim();
  const contactId = input.contactId;
  if (!businessId || (!phone && (contactId === undefined || contactId === null))) return false;

  const patch = buildNoResponseReactivationPatch();
  let updated: { id?: unknown }[] | null = null;
  let error: { message?: string } | null = null;

  if (contactId !== undefined && contactId !== null) {
    const result = await input.supabase
      .from("contacts")
      .update(patch)
      .eq("id", contactId)
      .eq("business_id", businessId)
      .not("wa_no_response_at", "is", null)
      .select("id");
    updated = result.data;
    error = result.error;
  } else {
    const phoneVariants = contactPhoneLookupVariants(phone);
    if (!phoneVariants.length) return false;
    const result = await input.supabase
      .from("contacts")
      .update(patch)
      .eq("business_id", businessId)
      .in("phone", phoneVariants)
      .not("wa_no_response_at", "is", null)
      .select("id");
    updated = result.data;
    error = result.error;
  }

  if (error) {
    console.error("[wa-no-response] reactivation update failed:", error.message);
    return false;
  }
  if (!updated?.length) return false;

  const { logMessage } = await import("@/lib/analytics");
  await logMessage({
    business_slug: input.businessSlug,
    role: "event",
    content: "[heyzoe:no_response:reactivated]",
    model_used: "no_response_reactivated",
    session_id: input.sessionId,
  }).catch((e) => console.error("[wa-no-response] reactivation log failed:", e));

  return true;
}
