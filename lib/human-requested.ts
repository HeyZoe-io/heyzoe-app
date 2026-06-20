import { contactPhoneLookupVariants } from "@/lib/phone-normalize";

export function buildHumanRequestedContactPatch(atIso: string): Record<string, unknown> {
  return {
    human_requested_at: atIso,
    wa_next_followup_at: null,
    wa_no_response_due_at: null,
    wa_followup_stage: 3,
    followup_sent: true,
  };
}

/** עדכון DB + אירוע + התראות בעלים + CRM (idempotent — לא חוזר אם כבר סומן) */
export async function handleLeadHumanRequested(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  nowIso: string;
  sessionId: string;
  fullName?: string | null;
}): Promise<{ already: boolean }> {
  const businessId = Number(input.businessId);
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  if (!businessId || !phoneVariants.length) return { already: false };

  const { data: existing } = await input.supabase
    .from("contacts")
    .select("human_requested_at, full_name")
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((existing as { human_requested_at?: string | null } | null)?.human_requested_at) {
    return { already: true };
  }

  const patch = buildHumanRequestedContactPatch(input.nowIso);
  const { error: updateErr } = await input.supabase
    .from("contacts")
    .update(patch)
    .eq("business_id", businessId)
    .in("phone", phoneVariants);

  if (updateErr) {
    console.error("[human-requested] contact update failed:", updateErr.message);
    return { already: false };
  }

  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const { logMessage } = await import("@/lib/analytics");
  await logMessage({
    business_slug: slug,
    role: "event",
    content: "[heyzoe:human_requested]",
    model_used: "human_requested",
    session_id: input.sessionId,
  });

  const fullName =
    String(input.fullName ?? "").trim() ||
    String((existing as { full_name?: string | null } | null)?.full_name ?? "").trim() ||
    null;

  const { triggerHumanRequestedNotification } = await import("@/lib/notifications/triggers");
  void triggerHumanRequestedNotification({
    businessId,
    leadPhone: input.phone,
    requestedAtIso: input.nowIso,
  }).catch((e) => console.error("[human-requested] owner notification failed:", e));

  const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
  void dispatchCrmEvent({
    businessId,
    leadPhone: input.phone,
    kind: "human_requested",
    fullName,
    eventAtIso: input.nowIso,
  }).catch((e) => console.error("[human-requested] CRM dispatch failed:", e));

  return { already: false };
}
