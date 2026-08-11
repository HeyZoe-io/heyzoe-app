/**
 * Non-Arbox no_response re-engage: template after ≥delay_days of silence
 * (min 2 days). Reuses waNoResponseEligible + shared message helpers from
 * the within-24h follow-up layer.
 */
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  leadTemplateUsesFirstName,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { logMessage } from "@/lib/analytics";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, normalizePhone, waSessionIdLookupVariants } from "@/lib/phone-normalize";
import {
  buildNoResponseScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  resolveNoResponseTemplateTrigger,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import {
  fetchLatestRealAssistantMessageAt,
  fetchLatestUserMessageAt,
  hasUserReplyAfter,
} from "@/lib/wa-followup-cron-eval";
import { waNoResponseEligible } from "@/lib/wa-no-response";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_24H = 24 * 60 * 60 * 1000;
const CANDIDATE_BATCH = 200;

export type NoResponseDispatch = "immediate" | "deferred" | "gated" | "skipped";

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

/** Already re-engaged this silence episode: marker is on/after the last inbound. */
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
};

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
}): Promise<NoResponseDispatch> {
  const phoneNorm =
    normalizePhone(input.contact.phone) ?? String(input.contact.phone ?? "").replace(/\D/g, "");
  if (!phoneNorm) return "skipped";

  const dueAt = computeNoResponseDueAt(input.lastUserAtIso, input.rule.delay_days);
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
    if (!enqueueResult.ok) return "skipped";
    await markReengagedAt(input.admin, input.contact.id, input.now.toISOString());
    return "deferred";
  }

  const channel = await resolveSendChannelForContact(
    input.admin,
    input.businessId,
    phoneNorm
  );
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language")
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

  const firstName = firstNameFromFullName(String(input.contact.full_name ?? ""));
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";

  const sendResult = await sendBusinessTemplate({
    to: phoneNorm,
    phoneNumberId,
    templateName: input.templateName,
    languageCode,
    ...(leadTemplateUsesFirstName(input.templateName)
      ? {
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: firstName }],
            },
          ],
        }
      : {}),
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
    return "skipped";
  }

  const sessionId = buildWaSessionId(phoneNumberId, phoneNorm);
  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(input.templateName, { firstName }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: sessionId || null,
  });

  await markReengagedAt(input.admin, input.contact.id, input.now.toISOString());
  return "immediate";
}

/**
 * Process one business with an enabled no_response rule.
 * IO: one candidate contacts query + per-candidate message lookups + optional Meta send.
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

  const rule = await resolveNoResponseTemplateTrigger({
    admin: input.admin,
    businessId: input.businessId,
  });
  const templateName = rule?.template_name?.trim() || null;
  if (!rule || !templateName) {
    bump(summary, "no_rule");
    return summary;
  }
  if (!isValidNoResponseDelayDays(rule.delay_days)) {
    bump(summary, "invalid_delay_days");
    console.error("[no-response-reengage] rule delay_days < 2 — skipping business", {
      businessId: input.businessId,
      delay_days: rule.delay_days,
    });
    return summary;
  }

  const silenceCutoffIso = new Date(nowMs - rule.delay_days * MS_DAY).toISOString();

  const { data: rows, error } = await input.admin
    .from("contacts")
    .select(
      "id, phone, full_name, last_contact_at, wa_last_reengaged_at, opted_out, not_relevant_at, human_requested_at, trial_registered, session_phase"
    )
    .eq("business_id", input.businessId)
    .eq("source", "whatsapp")
    .or("opted_out.eq.false,opted_out.is.null")
    .is("not_relevant_at", null)
    .is("human_requested_at", null)
    .or("trial_registered.eq.false,trial_registered.is.null")
    .or("session_phase.is.null,session_phase.neq.registered")
    .not("last_contact_at", "is", null)
    .lte("last_contact_at", silenceCutoffIso)
    .order("last_contact_at", { ascending: true })
    .limit(CANDIDATE_BATCH);

  if (error) {
    console.error("[no-response-reengage] candidates query failed:", error.message, {
      businessId: input.businessId,
    });
    bump(summary, "query_failed");
    return summary;
  }

  for (const row of rows ?? []) {
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

      if (!isSilentLongEnough(lastUserAtIso, rule.delay_days, nowMs)) {
        bump(summary, "not_silent_long_enough");
        continue;
      }

      if (isNoResponseEpisodeAlreadyReengaged(contact.wa_last_reengaged_at, lastUserAtIso)) {
        bump(summary, "already_reengaged_episode");
        continue;
      }

      const dispatch = await dispatchNoResponseTemplate({
        admin: input.admin,
        businessId: input.businessId,
        businessSlug,
        contact,
        rule,
        templateName,
        lastUserAtIso,
        now,
      });

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
