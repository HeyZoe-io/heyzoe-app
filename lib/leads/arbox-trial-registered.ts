import { HEYZOE_SF_REGISTERED, logMessage } from "@/lib/analytics";
import { buildTrialRegisteredContactPatch } from "@/lib/trial-registered-manual";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendTrialRegisteredWhatsAppReplyIfInWindow } from "@/lib/trial-registered-wa-reply";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

/** One row from Arbox GET /v3/reports/trialClassesReport `data[]`. */
export type ArboxTrialClassReportRow = {
  user_id: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  date: unknown;
  start_time: unknown;
  class_name?: unknown;
  location_name?: unknown;
  status_id?: unknown;
};

export type ArboxTrialClassRegisteredResult =
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

function resolveReportFullName(row: ArboxTrialClassReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function resolveReportSchedule(row: ArboxTrialClassReportRow): {
  classDate: string;
  startTime: string;
  requestedDate: string | null;
  requestedTime: string | null;
} {
  const classDate = String(row.date ?? "").trim();
  const startTime = String(row.start_time ?? "").trim();
  return {
    classDate,
    startTime,
    requestedDate: classDate || null,
    requestedTime: startTime || null,
  };
}

type ExistingContactRow = {
  id?: number;
  phone?: string;
  full_name?: string | null;
  trial_registered?: boolean | null;
  session_phase?: string | null;
  opted_out?: boolean | null;
  not_relevant_at?: string | null;
  instagram_follow_prompt_sent?: boolean | null;
  arbox_user_id?: string | null;
};

/**
 * רישום לשיעור ניסיון ב-Arbox (trialClassesReport) → מסמן contact בזואי.
 * Arbox הוא מקור האמת — לא שולח חזרה ל-CRM.
 */
export async function handleArboxTrialClassRegistered(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  row: ArboxTrialClassReportRow;
}): Promise<ArboxTrialClassRegisteredResult> {
  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return { ok: false, error: "invalid_business_id" };
  }
  if (!businessSlug) {
    return { ok: false, error: "missing_business_slug" };
  }

  const arboxUserId = String(input.row.user_id ?? "").trim();
  const { classDate, startTime, requestedDate, requestedTime } = resolveReportSchedule(input.row);
  const fullName = resolveReportFullName(input.row);

  if (!arboxUserId) {
    return { ok: false, error: "missing_arbox_user_id" };
  }
  if (!classDate || !startTime) {
    return { ok: false, error: "missing_class_schedule" };
  }

  const dedupPayload = {
    business_id: businessId,
    arbox_user_id: arboxUserId,
    class_date: classDate,
    start_time: startTime,
  };

  // PostgREST: ignoreDuplicates → INSERT … ON CONFLICT DO NOTHING.
  // .select() returns rows only when a row was inserted; conflicts return [].
  const { data: dedupRows, error: dedupErr } = await input.admin
    .from("arbox_trial_sync_log")
    .upsert(dedupPayload, {
      onConflict: "business_id,arbox_user_id,class_date,start_time",
      ignoreDuplicates: true,
    })
    .select("business_id");

  if (dedupErr) {
    console.error("[leads/arbox-trial-registered] dedup insert failed:", dedupErr.message);
    return { ok: false, error: "dedup_insert_failed" };
  }

  if (!dedupRows?.length) {
    const { data: existingLog, error: existingLogErr } = await input.admin
      .from("arbox_trial_sync_log")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("arbox_user_id", arboxUserId)
      .eq("class_date", classDate)
      .eq("start_time", startTime)
      .maybeSingle();

    if (existingLogErr) {
      console.error("[leads/arbox-trial-registered] dedup existence check failed:", existingLogErr.message);
      return { ok: false, error: "dedup_insert_failed" };
    }
    if (existingLog) {
      return { ok: true, already: true };
    }
    console.error("[leads/arbox-trial-registered] dedup insert returned no row and PK missing", {
      businessId,
      arboxUserId,
      classDate,
      startTime,
    });
    return { ok: false, error: "dedup_insert_failed" };
  }

  const phoneNorm = normalizePhone(input.row.phone);

  let existing: ExistingContactRow | undefined;

  const { data: byArboxRows, error: byArboxErr } = await input.admin
    .from("contacts")
    .select(
      "id, phone, full_name, trial_registered, session_phase, opted_out, not_relevant_at, instagram_follow_prompt_sent, arbox_user_id"
    )
    .eq("business_id", businessId)
    .eq("arbox_user_id", arboxUserId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (byArboxErr) {
    console.error("[leads/arbox-trial-registered] contact lookup by arbox_user_id failed:", byArboxErr.message);
    return { ok: false, error: "contact_lookup_failed" };
  }
  existing = byArboxRows?.[0] as ExistingContactRow | undefined;

  if (!existing && phoneNorm) {
    const phoneVariants = contactPhoneLookupVariants(phoneNorm);
    const { data: byPhoneRows, error: byPhoneErr } = await input.admin
      .from("contacts")
      .select(
        "id, phone, full_name, trial_registered, session_phase, opted_out, not_relevant_at, instagram_follow_prompt_sent, arbox_user_id"
      )
      .eq("business_id", businessId)
      .in("phone", phoneVariants.length ? phoneVariants : [phoneNorm])
      .order("updated_at", { ascending: false })
      .limit(1);

    if (byPhoneErr) {
      console.error("[leads/arbox-trial-registered] contact lookup by phone failed:", byPhoneErr.message);
      return { ok: false, error: "contact_lookup_failed" };
    }
    existing = byPhoneRows?.[0] as ExistingContactRow | undefined;
  }

  const alreadyRegistered =
    existing?.trial_registered === true ||
    String(existing?.session_phase ?? "").trim() === "registered";

  if (alreadyRegistered) {
    const existingArboxId = String(existing?.arbox_user_id ?? "").trim();
    if (existing?.id && !existingArboxId) {
      const { error: backfillErr } = await input.admin
        .from("contacts")
        .update({ arbox_user_id: arboxUserId })
        .eq("id", existing.id);
      if (backfillErr) {
        console.warn("[leads/arbox-trial-registered] arbox_user_id backfill failed:", backfillErr.message);
      }
    }
    return { ok: true, already: true };
  }

  if (!existing && !phoneNorm) {
    return { ok: false, error: "invalid_phone" };
  }

  const hadNotRelevant = Boolean(existing?.not_relevant_at);
  const hadOptedOut = existing?.opted_out === true;

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    ...buildTrialRegisteredContactPatch(nowIso),
    not_relevant_at: null,
    not_relevant_reason: "",
    human_requested_at: null,
    wa_no_response_at: null,
    updated_at: nowIso,
    arbox_user_id: arboxUserId,
  };
  if (fullName) patch.full_name = fullName;

  let contactCreated = false;
  const canonicalPhone = String(existing?.phone ?? phoneNorm ?? "").trim();

  if (!existing) {
    const { error: insertErr } = await input.admin.from("contacts").insert({
      business_id: businessId,
      phone: phoneNorm,
      full_name: fullName,
      source: "arbox_trial",
      ...patch,
    });
    if (insertErr) {
      console.error("[leads/arbox-trial-registered] contact insert failed:", insertErr.message);
      return { ok: false, error: "contact_upsert_failed" };
    }
    contactCreated = true;
  } else {
    const { error: updateErr } = await input.admin
      .from("contacts")
      .update(patch)
      .eq("business_id", businessId)
      .eq("id", existing.id!);
    if (updateErr) {
      console.error("[leads/arbox-trial-registered] contact update failed:", updateErr.message);
      return { ok: false, error: "contact_upsert_failed" };
    }
  }

  if (hadNotRelevant || hadOptedOut) {
    console.info("[leads/arbox-trial-registered] arbox overrode zoe status", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      had_not_relevant: hadNotRelevant,
      had_opted_out: hadOptedOut,
    });
  }

  const { data: business } = await input.admin
    .from("businesses")
    .select("plan")
    .eq("id", businessId)
    .maybeSingle();

  const channel = await resolveSendChannelForContact(input.admin, businessId, canonicalPhone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  const sessionId =
    phoneNumberId && canonicalPhone ? buildWaSessionId(phoneNumberId, canonicalPhone) : null;

  await logMessage({
    business_slug: businessSlug,
    role: "event",
    content: HEYZOE_SF_REGISTERED,
    model_used: "sf_registered_arbox_poll",
    session_id: sessionId,
  });

  const waResult = await sendTrialRegisteredWhatsAppReplyIfInWindow({
    admin: input.admin,
    businessId,
    businessSlug,
    phone: canonicalPhone,
    instagramFollowPromptSent: existing?.instagram_follow_prompt_sent === true,
    businessPlan: (business as { plan?: unknown } | null)?.plan,
  });

  try {
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
        requestedDate,
        requestedTime,
      });
    }
  } catch (e) {
    console.warn("[leads/arbox-trial-registered] owner notification failed:", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const whatsapp = waResult.sent ? "sent" : waResult.reason;
  if (!waResult.sent) {
    console.info("[leads/arbox-trial-registered] whatsapp skipped", {
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
