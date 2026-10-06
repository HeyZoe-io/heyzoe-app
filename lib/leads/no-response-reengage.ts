/**
 * Non-Arbox no_response re-engage: template after ≥delay_days of silence
 * (min 2 days). Reuses waNoResponseEligible + shared message helpers from
 * the within-24h follow-up layer.
 */
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { logMessage } from "@/lib/analytics";
import { eventBeforeRuleActivation, parseReportEventInstant } from "@/lib/rule-activation";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import {
  buildWaSessionId,
  contactPhoneLookupVariants,
  normalizePhone,
  waSessionIdLookupVariants,
} from "@/lib/phone-normalize";
import {
  buildNoResponseScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logDedupBlockedSend } from "@/lib/leads/dedup-fail-closed";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import {
  companionTemplateAlreadySent,
  recordCompanionTemplateSent,
  settleCompanionTemplateSent,
  rulesForCompanionSend,
  runCompanionTemplateSends,
} from "@/lib/same-trigger-template-order";
import {
  loadEnabledNoResponseTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import {
  fetchLatestRealAssistantMessageAt,
  fetchLatestUserMessageAt,
  hasUserReplyAfter,
} from "@/lib/wa-followup-cron-eval";
import {
  fetchArboxActiveProductKeys,
  matchesActiveProduct,
  type ActiveProductKeys,
} from "@/lib/leads/arbox-active-product";
import { canUseArboxScheduleLookup } from "@/lib/crm/types";
import { waNoResponseEligible } from "@/lib/wa-no-response";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";
import {
  NO_RESPONSE_RECENT_TEMPLATE_MS,
  noResponseAudienceBlocks,
  type NoResponseAudienceMessage,
} from "@/lib/leads/no-response-audience";

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_24H = 24 * 60 * 60 * 1000;
const CANDIDATE_BATCH = 200;

/** Failures that will not change until the lead writes again. */
const NO_RESPONSE_TERMINAL_SKIP_REASONS = new Set([
  "no_valid_name",
  "no_zoe_conversation",
  "arbox_member",
  "member_sync_log",
]);

export function shouldCloseNoResponseEpisode(reason: string): boolean {
  return NO_RESPONSE_TERMINAL_SKIP_REASONS.has(reason);
}

/**
 * SQL open-episode predicate:
 * wa_last_reengaged_at IS NULL OR wa_last_reengaged_at < last_contact_at.
 */
export function isNoResponseCandidateOpen(
  waLastReengagedAt: string | null | undefined,
  lastContactAt: string | null | undefined
): boolean {
  const contactMs = Date.parse(String(lastContactAt ?? "").trim());
  if (!Number.isFinite(contactMs)) return false;
  return !isNoResponseEpisodeAlreadyReengaged(waLastReengagedAt, String(lastContactAt));
}

/** One page only. Closed rows are dropped and not replaced from a later page. */
export function takeOpenNoResponseCandidates<T extends {
  wa_last_reengaged_at?: string | null;
  last_contact_at?: string | null;
}>(rows: readonly T[], cap: number = CANDIDATE_BATCH): T[] {
  const open: T[] = [];
  const limit = Math.max(0, Math.trunc(cap));
  for (const row of rows) {
    if (!isNoResponseCandidateOpen(row.wa_last_reengaged_at, row.last_contact_at)) continue;
    open.push(row);
    if (open.length >= limit) break;
  }
  return open;
}

/** PostgREST schema-cache miss for no_response_open_candidates. */
export function isMissingNoResponseCandidatesRpc(error: {
  message?: string;
  code?: string;
} | null | undefined): boolean {
  if (!error) return false;
  if (String(error.code ?? "") === "PGRST202") return true;
  const message = String(error.message ?? "");
  return /no_response_open_candidates/i.test(message) && /does not exist|could not find|schema cache/i.test(message);
}

/** Member-trigger logs. Phone is not a column; rows point at contact_id and (usually) user_id. */
const MEMBER_SYNC_LOGS: { table: string; userIdColumn: "user_id" | null }[] = [
  { table: "arbox_birthday_sync_log", userIdColumn: "user_id" },
  { table: "arbox_trial_attended_sync_log", userIdColumn: "user_id" },
  { table: "arbox_missed_class_sync_log", userIdColumn: "user_id" },
  { table: "arbox_attendance_gap_sync_log", userIdColumn: "user_id" },
  { table: "arbox_expiring_sync_log", userIdColumn: null },
  { table: "arbox_sessions_expiring_sync_log", userIdColumn: "user_id" },
  { table: "arbox_credit_refusal_sync_log", userIdColumn: null },
];

export type NoResponseDispatch = "immediate" | "deferred" | "gated" | "skipped" | "send_failed";

export type NoResponseReengageSummary = {
  examined: number;
  sent: number;
  deferred: number;
  gated: number;
  skipped: number;
  skip_counts: Record<string, number>;
};

/** Silence-episode key from last inbound timestamp (stable for the episode). */
export function silenceEpisodeKeyFromLastUserAt(lastUserAtIso: string): string {
  const raw = String(lastUserAtIso ?? "").trim();
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw.slice(0, 64) || "unknown";
  // Full ISO instant — a new inbound changes last_user_at → new episode key.
  return new Date(ms).toISOString();
}

/** Already closed this silence episode: marker is on/after the last inbound.
 *  Set on a real re-engage and on a terminal skip (no_valid_name, no Zoe
 *  exchange, Arbox member). A newer inbound opens a new episode. */
export function isNoResponseEpisodeAlreadyReengaged(
  waLastReengagedAt: string | null | undefined,
  lastUserAtIso: string
): boolean {
  const reMs = Date.parse(String(waLastReengagedAt ?? "").trim());
  const userMs = Date.parse(String(lastUserAtIso ?? "").trim());
  if (!Number.isFinite(userMs)) return true;
  if (!Number.isFinite(reMs)) return false;
  return reMs >= userMs;
}

/** Belt-and-suspenders: never overlap the <24h session follow-up layer. */
export function isBeyondSessionFollowupWindow(
  lastUserAtIso: string,
  nowMs: number = Date.now()
): boolean {
  const userMs = Date.parse(String(lastUserAtIso ?? "").trim());
  if (!Number.isFinite(userMs)) return false;
  return nowMs - userMs >= MS_24H;
}

export function isSilentLongEnough(
  lastUserAtIso: string,
  delayDays: number,
  nowMs: number = Date.now()
): boolean {
  const days = Math.max(0, Math.trunc(Number(delayDays) || 0));
  const userMs = Date.parse(String(lastUserAtIso ?? "").trim());
  if (!Number.isFinite(userMs)) return false;
  return nowMs - userMs >= days * MS_DAY;
}

export function computeNoResponseDueAt(lastUserAtIso: string, delayDays: number): Date {
  const userMs = Date.parse(String(lastUserAtIso ?? "").trim());
  const base = Number.isFinite(userMs) ? new Date(userMs) : new Date();
  return computeDueAt(
    { delay_days: Math.max(0, Math.trunc(Number(delayDays) || 0)), delay_direction: "after" },
    base
  );
}

/** Min API delay for no_response rules (mirrors triggers route). */
export function isValidNoResponseDelayDays(delayDays: number): boolean {
  return Number.isInteger(delayDays) && delayDays >= 2;
}

type ContactCandidate = {
  id: string | number;
  phone: string;
  full_name?: string | null;
  last_contact_at?: string | null;
  wa_last_reengaged_at?: string | null;
  opted_out?: boolean | null;
  not_relevant_at?: string | null;
  human_requested_at?: string | null;
  trial_registered?: boolean | null;
  session_phase?: string | null;
  arbox_user_id?: string | null;
  arbox_is_member?: boolean | null;
};

type MemberLogHits = { contactIds: Set<string>; userIds: Set<string> };

/**
 * One indexed read of up to 200 open episodes.
 * A missing RPC or a missing column is a failed read: this batch sends nothing.
 */
async function loadCandidateBatch(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  silenceCutoffIso: string
): Promise<{ rows: ContactCandidate[]; error: { message: string } | null }> {
  const { data, error } = await admin.rpc("no_response_open_candidates", {
    p_business_id: businessId,
    p_silence_cutoff: silenceCutoffIso,
    p_limit: CANDIDATE_BATCH,
  });
  if (error) {
    logDedupBlockedSend({
      log: "[no-response-reengage]",
      businessId,
      reason: error.message,
    });
    return { rows: [], error: { message: error.message } };
  }
  return {
    rows: takeOpenNoResponseCandidates((data ?? []) as ContactCandidate[], CANDIDATE_BATCH),
    error: null,
  };
}

/** One parallel round per business: member-trigger logs for this candidate set, not per contact. */
async function loadMemberSyncLogHits(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  contactIds: string[],
  userIds: string[]
): Promise<MemberLogHits> {
  const contactIdsHit = new Set<string>();
  const userIdsHit = new Set<string>();
  if (!contactIds.length && !userIds.length) return { contactIds: contactIdsHit, userIds: userIdsHit };

  await Promise.all(
    MEMBER_SYNC_LOGS.map(async (log) => {
      const columns = log.userIdColumn ? `contact_id, ${log.userIdColumn}` : "contact_id";
      let query = admin.from(log.table).select(columns).eq("business_id", businessId);
      if (contactIds.length && log.userIdColumn && userIds.length) {
        query = query.or(
          `contact_id.in.(${contactIds.join(",")}),${log.userIdColumn}.in.(${userIds.join(",")})`
        );
      } else if (contactIds.length) {
        query = query.in("contact_id", contactIds);
      } else if (log.userIdColumn && userIds.length) {
        query = query.in(log.userIdColumn, userIds);
      } else {
        return;
      }
      const { data, error } = await query.limit(5000);
      if (error) {
        logDedupBlockedSend({
          log: "[no-response-reengage]",
          businessId,
          reason: `${log.table}: ${error.message}`,
        });
        throw new Error(error.message);
      }
      for (const row of data ?? []) {
        const contactId = String((row as { contact_id?: unknown }).contact_id ?? "").trim();
        if (contactId) contactIdsHit.add(contactId);
        if (log.userIdColumn) {
          const userId = String((row as unknown as Record<string, unknown>)[log.userIdColumn] ?? "").trim();
          if (userId) userIdsHit.add(userId);
        }
      }
    })
  );
  return { contactIds: contactIdsHit, userIds: userIdsHit };
}

async function fetchAudienceMessages(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessSlug: string;
  sessionIds: string[];
  lastUserAtIso: string;
  nowMs: number;
}): Promise<NoResponseAudienceMessage[] | null> {
  const userMs = Date.parse(input.lastUserAtIso);
  const sinceMs = Math.min(
    Number.isFinite(userMs) ? userMs : input.nowMs,
    input.nowMs - NO_RESPONSE_RECENT_TEMPLATE_MS
  );
  const { data, error } = await input.admin
    .from("messages")
    .select("role, model_used, created_at")
    .eq("business_slug", input.businessSlug)
    .in("session_id", input.sessionIds)
    .gte("created_at", new Date(sinceMs).toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[no-response-reengage] audience messages failed:", error.message, {
      business_slug: input.businessSlug,
    });
    return null;
  }
  return (data ?? []) as NoResponseAudienceMessage[];
}

function bump(summary: NoResponseReengageSummary, reason: string) {
  summary.skipped += 1;
  summary.skip_counts[reason] = (summary.skip_counts[reason] ?? 0) + 1;
}

async function markReengagedAt(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  contactId: string | number,
  atIso: string
): Promise<void> {
  const { error } = await admin
    .from("contacts")
    .update({ wa_last_reengaged_at: atIso, updated_at: atIso })
    .eq("id", contactId);
  if (error) {
    console.error("[no-response-reengage] wa_last_reengaged_at update failed:", error.message, {
      contact_id: contactId,
    });
  }
}

async function dispatchNoResponseTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  contact: ContactCandidate;
  rule: PurchaseTemplateTriggerRule;
  templateName: string;
  lastUserAtIso: string;
  now: Date;
  dueOffsetMs?: number;
  /** Pair sends stamp the episode once, after every template in the pair. */
  markEpisode?: boolean;
}): Promise<NoResponseDispatch> {
  const phoneNorm =
    normalizePhone(input.contact.phone) ?? String(input.contact.phone ?? "").replace(/\D/g, "");
  if (!phoneNorm) return "skipped";

  const markEpisode = input.markEpisode !== false;
  const dueAt = new Date(
    computeNoResponseDueAt(input.lastUserAtIso, input.rule.delay_days).getTime() +
      Math.max(0, input.dueOffsetMs ?? 0)
  );
  const stampEpisode = () =>
    markEpisode
      ? markReengagedAt(input.admin, input.contact.id, input.now.toISOString())
      : Promise.resolve();
  const episodeKey = silenceEpisodeKeyFromLastUserAt(input.lastUserAtIso);

  if (dueAt.getTime() > input.now.getTime()) {
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: phoneNorm,
      templateName: input.templateName,
      dueAt,
      dedupKey: buildNoResponseScheduledDedupKey(
        input.businessId,
        input.rule.id,
        phoneNorm,
        episodeKey
      ),
    });
    console.info("[no-response-reengage] template trigger resolution", {
      businessId: input.businessId,
      contact_id: input.contact.id,
      matched_rule_id: input.rule.id,
      template_name: input.templateName,
      dispatch: "deferred",
      due_at: dueAt.toISOString(),
      enqueue_ok: enqueueResult.ok,
      enqueue_inserted: enqueueResult.ok ? enqueueResult.inserted : false,
    });
    if (!enqueueResult.ok) return "send_failed";
    await stampEpisode();
    return "deferred";
  }

  const channel = await resolveSendChannelForContact(
    input.admin,
    input.businessId,
    phoneNorm
  );
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id, name").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language, components")
      .eq("business_id", input.businessId)
      .eq("name", input.templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
  ]);

  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");

  if (!phoneNumberId || !wabaId || !approvedTpl?.id) {
    const gate = !phoneNumberId ? "no_channel" : !wabaId ? "no_waba" : "template_not_approved";
    console.info("[no-response-reengage] template trigger resolution", {
      businessId: input.businessId,
      contact_id: input.contact.id,
      matched_rule_id: input.rule.id,
      template_name: input.templateName,
      dispatch: "gated",
      gate,
    });
    return "gated";
  }

  const firstName = resolveTemplateFirstName(input.contact);
  if (!firstName && templateBodyUsesFirstNameSlot("no_response", (approvedTpl as { components?: unknown }).components)) {
    console.info("[no-response-reengage] skip", {
      reason: "no_valid_name",
      contact_id: input.contact.id,
    });
    await stampEpisode();
    return "skipped";
  }
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "no_response",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });

  const sendResult = await sendBusinessTemplate({
    to: phoneNorm,
    phoneNumberId,
    templateName: input.templateName,
    alertTriggerId: input.rule.id,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  console.info("[no-response-reengage] template trigger resolution", {
    businessId: input.businessId,
    contact_id: input.contact.id,
    matched_rule_id: input.rule.id,
    template_name: input.templateName,
    dispatch: "immediate",
    send_ok: sendResult.ok,
  });

  if (!sendResult.ok) {
    console.error("[no-response-reengage] template send failed:", sendResult.error);
    return templateFailureDispatch(sendResult.error);
  }

  const sessionId = buildWaSessionId(phoneNumberId, phoneNorm);
  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(input.templateName, {
      firstName,
      components: storedComponents,
      bodyParams,
    }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: sessionId || null,
  });

  await stampEpisode();
  return "immediate";
}

/**
 * Process one business with an enabled no_response rule.
 * IO: one candidate read of at most 200 open episodes (RPC + partial index;
 * closed rows are not scanned) + one phone-alias query + 7 member-log
 * lookups in parallel (not per contact) + per-candidate message lookups +
 * one audience message query (window covers the silence episode and the
 * 72h template cooldown; the 48h human cooldown sits inside that) +
 * optional Meta send. Terminal skips write wa_last_reengaged_at once per
 * episode. Until the RPC exists, one unfiltered page of 200 is filtered in memory.
 * The within-24h layer's hours_since_user >= 24 skip stays in wa-followup-cron-eval.
 * This cron uses the inverse (isBeyondSessionFollowupWindow) so the two do not overlap.
 * Arbox businesses with candidates: +1 activeMemberships, +1 sessions, +1 future
 * bookings once (membershipTypes only if trial product ids are set) so people
 * with a membership, punch card, or upcoming trial class are skipped.
 */
export async function syncNoResponseReengageForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  now?: Date;
}): Promise<NoResponseReengageSummary> {
  const summary: NoResponseReengageSummary = {
    examined: 0,
    sent: 0,
    deferred: 0,
    gated: 0,
    skipped: 0,
    skip_counts: {},
  };

  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();

  const rules = rulesForCompanionSend(
    await loadEnabledNoResponseTemplateTriggers(input.admin, input.businessId)
  ).filter((item) => isValidNoResponseDelayDays(item.delay_days) && item.template_name?.trim());
  if (!rules.length) {
    bump(summary, "no_rule");
    return summary;
  }
  const minDelayDays = Math.min(...rules.map((item) => item.delay_days));

  const silenceCutoffIso = new Date(nowMs - minDelayDays * MS_DAY).toISOString();

  const loaded = await loadCandidateBatch(input.admin, input.businessId, silenceCutoffIso);
  const rows = loaded.rows;
  const error = loaded.error;

  if (error) {
    console.error("[no-response-reengage] candidates query failed:", error.message, {
      businessId: input.businessId,
    });
    bump(summary, "query_failed");
    return summary;
  }

  let activeKeys: ActiveProductKeys | null = null;
  let activeCheckFailed = false;
  if ((rows ?? []).length) {
    const { data: bizRow, error: bizErr } = await input.admin
      .from("businesses")
      .select("crm_type, crm_api_key, crm_box_id, arbox_trial_membership_type_ids")
      .eq("id", input.businessId)
      .maybeSingle();
    if (bizErr) {
      console.error("[no-response-reengage] business crm lookup failed:", bizErr.message, {
        businessId: input.businessId,
      });
    }
    const apiKey = String((bizRow as { crm_api_key?: unknown } | null)?.crm_api_key ?? "").trim();
    const boxId = String((bizRow as { crm_box_id?: unknown } | null)?.crm_box_id ?? "").trim();
    if (canUseArboxScheduleLookup(bizRow) && apiKey && boxId) {
      const fetched = await fetchArboxActiveProductKeys({
        apiKey,
        boxId,
        now,
        trialMembershipTypeIds: (bizRow as { arbox_trial_membership_type_ids?: unknown } | null)
          ?.arbox_trial_membership_type_ids,
      });
      if (!fetched.ok) {
        activeCheckFailed = true;
        console.error("[no-response-reengage] active product fetch failed", {
          businessId: input.businessId,
          error: fetched.error,
        });
      } else {
        activeKeys = fetched.keys;
      }
    }
  }

  const candidateRows = rows as unknown as ContactCandidate[];
  const phoneToCandidateIds = new Map<string, string[]>();
  for (const row of candidateRows) {
    const id = String(row.id);
    for (const variant of contactPhoneLookupVariants(row.phone)) {
      const list = phoneToCandidateIds.get(variant) ?? [];
      list.push(id);
      phoneToCandidateIds.set(variant, list);
    }
  }
  const variantPhones = [...phoneToCandidateIds.keys()];
  const aliasIds = new Set(candidateRows.map((row) => String(row.id)));
  if (variantPhones.length) {
    const { data: aliases, error: aliasErr } = await input.admin
      .from("contacts")
      .select("id, phone")
      .eq("business_id", input.businessId)
      .in("phone", variantPhones);
    if (aliasErr) {
      console.error("[no-response-reengage] phone alias lookup failed:", aliasErr.message, {
        businessId: input.businessId,
      });
    } else {
      for (const alias of aliases ?? []) {
        const aliasId = String((alias as { id: unknown }).id);
        aliasIds.add(aliasId);
        for (const variant of contactPhoneLookupVariants((alias as { phone?: unknown }).phone)) {
          const owners = phoneToCandidateIds.get(variant) ?? [];
          for (const owner of owners) {
            const list = phoneToCandidateIds.get(aliasId) ?? [];
            if (!list.includes(owner)) list.push(owner);
            phoneToCandidateIds.set(aliasId, list);
          }
        }
      }
    }
  }
  const userIds = [
    ...new Set(
      candidateRows
        .map((row) => String(row.arbox_user_id ?? "").trim())
        .filter((id) => /^\d+$/.test(id))
    ),
  ];
  let memberLogs: MemberLogHits;
  try {
    memberLogs = await loadMemberSyncLogHits(
      input.admin,
      input.businessId,
      [...aliasIds],
      userIds
    );
  } catch {
    bump(summary, "query_failed");
    return summary;
  }
  const memberLogCandidateIds = new Set<string>();
  for (const contactId of memberLogs.contactIds) {
    memberLogCandidateIds.add(contactId);
    for (const owner of phoneToCandidateIds.get(contactId) ?? []) memberLogCandidateIds.add(owner);
  }

  for (const row of candidateRows) {
    summary.examined += 1;
    const contact = row as ContactCandidate;
    const contactId = contact.id;
    const phone = String(contact.phone ?? "").trim();
    if (!contactId || !phone) {
      bump(summary, "invalid_contact");
      continue;
    }

    // Shared gate with within-24h / status-check layer (do not fork).
    if (!waNoResponseEligible(contact)) {
      bump(summary, "gate_ineligible");
      continue;
    }

    if (activeCheckFailed) {
      bump(summary, "active_check_failed");
      continue;
    }
    if (activeKeys) {
      const arboxUserId = Number(String(contact.arbox_user_id ?? "").trim());
      if (
        matchesActiveProduct({
          userId: Number.isFinite(arboxUserId) && arboxUserId > 0 ? Math.trunc(arboxUserId) : null,
          phone,
          keys: activeKeys,
        })
      ) {
        bump(summary, "active_product");
        continue;
      }
    }

    try {
      const channel = await resolveSendChannelForContact(
        input.admin,
        input.businessId,
        phone
      );
      const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
      if (!phoneNumberId) {
        bump(summary, "no_active_channel");
        continue;
      }

      const sessionIds = waSessionIdLookupVariants(phoneNumberId, phone);
      const lastAssist = await fetchLatestRealAssistantMessageAt({
        admin: input.admin,
        business_slug: businessSlug,
        session_ids: sessionIds,
      });
      if (!lastAssist?.created_at) {
        bump(summary, "no_assistant_message");
        continue;
      }

      const lastUserAtIso = await fetchLatestUserMessageAt({
        admin: input.admin,
        business_slug: businessSlug,
        session_ids: sessionIds,
      });
      if (!lastUserAtIso) {
        bump(summary, "no_user_message");
        continue;
      }

      if (
        await hasUserReplyAfter({
          admin: input.admin,
          business_slug: businessSlug,
          session_ids: sessionIds,
          afterIso: lastAssist.created_at,
        })
      ) {
        bump(summary, "already_replied");
        continue;
      }

      if (!isBeyondSessionFollowupWindow(lastUserAtIso, nowMs)) {
        bump(summary, "under_24h");
        continue;
      }

      const dueRules = rules.filter(
        (item) =>
          isSilentLongEnough(lastUserAtIso, item.delay_days, nowMs) &&
          !eventBeforeRuleActivation(parseReportEventInstant(lastUserAtIso), item)
      );
      if (!dueRules.length) {
        bump(summary, "not_silent_long_enough");
        continue;
      }

      if (isNoResponseEpisodeAlreadyReengaged(contact.wa_last_reengaged_at, lastUserAtIso)) {
        bump(summary, "already_reengaged_episode");
        continue;
      }

      const audienceMessages = await fetchAudienceMessages({
        admin: input.admin,
        businessSlug,
        sessionIds,
        lastUserAtIso,
        nowMs,
      });
      if (!audienceMessages) {
        bump(summary, "audience_query_failed");
        continue;
      }
      const arboxUserId = String(contact.arbox_user_id ?? "").trim();
      const blocks = noResponseAudienceBlocks({
        arboxIsMember: contact.arbox_is_member === true,
        inMemberSyncLog:
          memberLogCandidateIds.has(String(contactId)) ||
          (arboxUserId !== "" && memberLogs.userIds.has(arboxUserId)),
        messages: audienceMessages,
        lastUserAtIso,
        nowMs,
      });
      if (blocks.length) {
        console.info("[no-response-reengage] skip", {
          reason: blocks[0],
          blocks,
          contact_id: contactId,
        });
        if (shouldCloseNoResponseEpisode(blocks[0])) {
          await markReengagedAt(input.admin, contactId, now.toISOString());
        }
        bump(summary, blocks[0]);
        continue;
      }

      const phoneNorm =
        normalizePhone(contact.phone) ?? String(contact.phone ?? "").replace(/\D/g, "");
      const episodeKey = silenceEpisodeKeyFromLastUserAt(lastUserAtIso);
      const dispatch = await runCompanionTemplateSends({
        rules: dueRules,
        dryRun: isArboxDailyDryRun(),
        send: (item, ctx) =>
          dispatchNoResponseTemplate({
            admin: input.admin,
            businessId: input.businessId,
            businessSlug,
            contact,
            rule: item,
            templateName: String(item.template_name ?? "").trim(),
            lastUserAtIso,
            now,
            dueOffsetMs: ctx.dueOffsetMs,
            markEpisode: false,
          }),
        alreadyDelivered: (item) =>
          companionTemplateAlreadySent(
            input.admin,
            buildNoResponseScheduledDedupKey(input.businessId, item.id, phoneNorm, episodeKey),
            { businessId: input.businessId, triggerId: item.id }
          ),
        recordDelivered: (item) =>
          recordCompanionTemplateSent(input.admin, {
            dedupKey: buildNoResponseScheduledDedupKey(
              input.businessId,
              item.id,
              phoneNorm,
              episodeKey
            ),
            businessId: input.businessId,
            ruleId: item.id,
            phone: phoneNorm,
            templateName: String(item.template_name ?? "").trim(),
            nowIso: now.toISOString(),
          }),
        settleDelivered: (item, status) =>
          settleCompanionTemplateSent(
            input.admin,
            buildNoResponseScheduledDedupKey(input.businessId, item.id, phoneNorm, episodeKey),
            status
          ),
      });

      const laterRules = rules.filter((item) => !dueRules.some((due) => due.id === item.id));
      if (
        laterRules.length === 0 &&
        (dispatch === "immediate" || dispatch === "deferred")
      ) {
        await markReengagedAt(input.admin, contactId, now.toISOString());
      }

      if (dispatch === "immediate") summary.sent += 1;
      else if (dispatch === "deferred") summary.deferred += 1;
      else if (dispatch === "gated") summary.gated += 1;
      else bump(summary, "dispatch_skipped");
    } catch (e) {
      console.error("[no-response-reengage] contact loop:", {
        contact_id: contactId,
        error: e instanceof Error ? e.message : String(e),
      });
      bump(summary, "exception");
    }
  }

  return summary;
}
