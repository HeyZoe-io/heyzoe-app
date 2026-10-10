import { isContactTrialRegistered } from "@/lib/contact-status";
import {
  buildWaSessionId,
  contactPhoneLookupVariants,
  waSessionIdVariantsFromSessionId,
} from "@/lib/phone-normalize";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";
import { stampLeaveRequest } from "@/lib/leads/leave-request";

/**
 * Stage 3 is «ללא מענה» in the list and also «no more follow-ups».
 * The DB trigger recomputes wa_next_followup_at from stages 0–2, and the
 * follow-up cron still sends when the stage is under 3 even if the timestamp
 * was nulled. Stage 4 keeps follow-ups off without painting «ללא מענה».
 * The next inbound from the lead resets the stage to 0.
 */
export const HUMAN_REPLY_FOLLOWUP_HOLD_STAGE = 4;

/** WhatsApp Business app text only. Reactions are dropped before this. Media does not clear. */
export function appEchoTextClearsHumanRequested(metaType: string | null | undefined): boolean {
  return String(metaType ?? "").trim() === "text";
}

/** Dashboard manual send (text or media) is a human reply. */
export function manualDashboardSendClearsHumanRequested(): boolean {
  return true;
}

export function buildHumanReplyClearsRequestPatch(): Record<string, unknown> {
  return {
    human_requested_at: null,
    wa_followup_stage: HUMAN_REPLY_FOLLOWUP_HOLD_STAGE,
  };
}

export function isHumanReplyFollowupHold(stage: unknown): boolean {
  return Number(stage) === HUMAN_REPLY_FOLLOWUP_HOLD_STAGE;
}

/** During the app-echo pause a new lead message must not set the tag again. */
export function leadMessageMaySetHumanRequested(sessionPaused: boolean): boolean {
  return sessionPaused !== true;
}

export function skipHumanRequestedOwnerWhatsAppWhenTaskCreated(
  createdHumanRequestTask: boolean
): boolean {
  return createdHumanRequestTask === true;
}

/**
 * Studios with an Arbox task type get the task only. A failed create does not fall back to owner WhatsApp.
 * Arbox studios without a task type get the owner WhatsApp.
 */
export function skipHumanRequestedOwnerWhatsApp(input: {
  taskCreated: boolean;
  arboxTaskHandoff: boolean;
}): boolean {
  return input.arboxTaskHandoff === true || input.taskCreated === true;
}

export function buildHumanRequestedContactPatch(atIso: string): Record<string, unknown> {
  return {
    human_requested_at: atIso,
    wa_next_followup_at: null,
    wa_no_response_due_at: null,
    wa_followup_stage: 3,
    followup_sent: true,
  };
}

/** «אשמח לפרטים» אחרי בקשת נציג — מחזיר את זואי לפעיל. */
export function buildHumanRequestedReactivationPatch(): Record<string, unknown> {
  return {
    human_requested_at: null,
    wa_followup_stage: 0,
    followup_sent: false,
  };
}

export async function reactivateHumanRequestedLead(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  phone: string;
  contactId?: string | number | null;
}): Promise<boolean> {
  const businessId = Number(input.businessId);
  const phone = String(input.phone ?? "").trim();
  const contactId = input.contactId;
  if (!businessId || (!phone && (contactId === undefined || contactId === null))) return false;

  const patch = buildHumanRequestedReactivationPatch();
  let error: { message?: string } | null = null;
  let updated: { id?: unknown }[] | null = null;

  if (contactId !== undefined && contactId !== null) {
    const result = await input.supabase
      .from("contacts")
      .update(patch)
      .eq("id", contactId)
      .eq("business_id", businessId)
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
      .select("id");
    updated = result.data;
    error = result.error;
  }

  if (error) {
    console.error("[human-requested] reactivate failed:", error.message);
    return false;
  }
  return Boolean(updated?.length);
}

/** One contacts update. No-op when the tag is already clear (WHERE human_requested_at IS NOT NULL). */
export async function clearHumanRequestedAfterStaffReply(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  phone: string;
}): Promise<{ cleared: boolean }> {
  const businessId = Number(input.businessId);
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  if (!businessId || !phoneVariants.length) return { cleared: false };

  const { data, error } = await input.supabase
    .from("contacts")
    .update(buildHumanReplyClearsRequestPatch())
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .not("human_requested_at", "is", null)
    .select("id");

  if (error) {
    console.error("[human-requested] clear after staff reply failed:", error.message);
    return { cleared: false };
  }
  return { cleared: Boolean(data?.length) };
}

/** עדכון DB + אירוע + התראות בעלים + CRM (idempotent — לא חוזר אם כבר סומן). גם אחרי הרשמה — נשמר «ביקש נציג + נרשם». */
export async function handleLeadHumanRequested(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  nowIso: string;
  sessionId: string;
  fullName?: string | null;
  /** מועד שיחה שנבחר (יום+בלוק) — נוסף למייל בעלים אם קיים */
  callScheduleSlot?: string | null;
  /** Closed-playbook category of this handoff. cancellation / freeze / complaint pause retention for 14 days. */
  reason?: string | null;
}): Promise<{ already: boolean }> {
  const businessId = Number(input.businessId);
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  if (!businessId || !phoneVariants.length) return { already: false };

  await stampLeaveRequest({
    admin: input.supabase as never,
    businessId,
    phoneVariants,
    kind: input.reason,
    nowIso: input.nowIso,
  });

  const sessionId = String(input.sessionId ?? "").trim();
  if (sessionId) {
    const { isBusinessWaSessionPaused } = await import("@/lib/wa-app-echo-pause");
    const sessionIds = waSessionIdVariantsFromSessionId(sessionId);
    const paused = await isBusinessWaSessionPaused({
      admin: input.supabase as never,
      businessSlug: input.businessSlug,
      sessionIds: sessionIds.length ? sessionIds : [sessionId],
    });
    if (!leadMessageMaySetHumanRequested(paused)) {
      return { already: true };
    }
  }

  const { data: existing } = await input.supabase
    .from("contacts")
    .select("human_requested_at, full_name, trial_registered, session_phase")
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((existing as { human_requested_at?: string | null } | null)?.human_requested_at) {
    return { already: true };
  }

  const patch = buildHumanRequestedContactPatch(input.nowIso);
  const { data: marked, error: updateErr } = await input.supabase
    .from("contacts")
    .update(patch)
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .is("human_requested_at", null)
    .select("id");

  if (updateErr) {
    console.error("[human-requested] contact update failed:", updateErr.message);
    return { already: false };
  }
  if (!marked?.length) {
    return { already: true };
  }

  const { lockFollowupSeriesForHumanInvolvement } = await import("@/lib/followup-series-lock");
  await lockFollowupSeriesForHumanInvolvement({
    admin: input.supabase,
    businessId,
    phone: input.phone,
    nowIso: input.nowIso,
    reason: "human_requested",
  });

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

  let createdHumanRequestTask = false;
  let arboxTaskHandoff = false;
  try {
    const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
    const crm = await dispatchCrmEvent({
      businessId,
      leadPhone: input.phone,
      kind: "human_requested",
      fullName,
      eventAtIso: input.nowIso,
      skipLeadCreation: isContactTrialRegistered(existing ?? {}),
    });
    createdHumanRequestTask = crm.createdHumanRequestTask === true;
    arboxTaskHandoff = crm.arboxTaskHandoff === true;
  } catch (e) {
    console.error("[human-requested] CRM dispatch failed:", e);
  }

  const { triggerHumanRequestedNotification } = await import("@/lib/notifications/triggers");
  await triggerHumanRequestedNotification({
    businessId,
    leadPhone: input.phone,
    requestedAtIso: input.nowIso,
    callScheduleSlot: input.callScheduleSlot ?? null,
    skipWhatsapp: skipHumanRequestedOwnerWhatsApp({
      taskCreated: createdHumanRequestTask,
      arboxTaskHandoff,
    }),
  }).catch((e) => console.error("[human-requested] owner notification failed:", e));

  return { already: false };
}

/** סימון ידני מדשבורד — עוצר פולואפים, התראה לבעלים + CRM, ללא הודעה לליד */
export async function markContactHumanRequestedManually(input: {
  admin: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName?: string | null;
}): Promise<{ ok: true; human_requested_at: string; already?: boolean } | { ok: false; error: string }> {
  const businessId = Number(input.businessId);
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  if (!businessId || !phoneVariants.length) {
    return { ok: false, error: "invalid_phone" };
  }

  const { data: existing } = await input.admin
    .from("contacts")
    .select("human_requested_at, full_name, trial_registered, session_phase")
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((existing as { human_requested_at?: string | null } | null)?.human_requested_at) {
    return {
      ok: true,
      human_requested_at: String((existing as { human_requested_at?: string | null }).human_requested_at),
      already: true,
    };
  }

  const nowIso = new Date().toISOString();
  const patch = buildHumanRequestedContactPatch(nowIso);

  const { data: updated, error } = await input.admin
    .from("contacts")
    .update(patch)
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .select("id");

  if (error) {
    console.error("[human-requested] manual mark failed:", error.message);
    return { ok: false, error: "update_failed" };
  }
  if (!updated?.length) {
    return { ok: false, error: "contact_not_found" };
  }

  const { lockFollowupSeriesForHumanInvolvement } = await import("@/lib/followup-series-lock");
  await lockFollowupSeriesForHumanInvolvement({
    admin: input.admin,
    businessId,
    phone: input.phone,
    nowIso,
    reason: "human_requested",
  });

  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const channel = await resolveSendChannelForContact(input.admin, businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  const sessionId = phoneNumberId ? buildWaSessionId(phoneNumberId, input.phone) : null;

  const { logMessage } = await import("@/lib/analytics");
  await logMessage({
    business_slug: slug,
    role: "event",
    content: "[heyzoe:human_requested:manual]",
    model_used: "human_requested_manual",
    session_id: sessionId,
  });

  const fullName =
    String(input.fullName ?? "").trim() ||
    String((existing as { full_name?: string | null } | null)?.full_name ?? "").trim() ||
    null;

  let createdHumanRequestTask = false;
  let arboxTaskHandoff = false;
  try {
    const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
    const crm = await dispatchCrmEvent({
      businessId,
      leadPhone: input.phone,
      kind: "human_requested",
      fullName,
      eventAtIso: nowIso,
      skipLeadCreation: isContactTrialRegistered(existing ?? {}),
    });
    createdHumanRequestTask = crm.createdHumanRequestTask === true;
    arboxTaskHandoff = crm.arboxTaskHandoff === true;
  } catch (e) {
    console.error("[human-requested] manual CRM dispatch failed:", e);
  }

  const { triggerHumanRequestedNotification } = await import("@/lib/notifications/triggers");
  await triggerHumanRequestedNotification({
    businessId,
    leadPhone: input.phone,
    requestedAtIso: nowIso,
    skipWhatsapp: skipHumanRequestedOwnerWhatsApp({
      taskCreated: createdHumanRequestTask,
      arboxTaskHandoff,
    }),
  }).catch((e) => console.error("[human-requested] manual owner notification failed:", e));

  return { ok: true, human_requested_at: nowIso };
}

/** כבר נשלחה לליד הודעת «אין בעיה» / העברה לנציג בפלואו מכירה. */
export async function recentSalesFlowHumanHandoffSent(input: {
  businessSlug: string;
  sessionId: string;
}): Promise<boolean> {
  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  if (!slug || !sessionId) return false;

  const { createSupabaseAdminClient } = await import("@/lib/supabase-admin");
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("messages")
    .select("model_used, content")
    .eq("business_slug", slug)
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(8);

  for (const row of data ?? []) {
    const model = String((row as { model_used?: string }).model_used ?? "");
    if (/sales_flow_human_agent_handoff/i.test(model)) return true;
    const content = String((row as { content?: string }).content ?? "");
    if (/נציג אנושי יחזור|נציג אנושי יצור/i.test(content)) return true;
  }
  return false;
}
