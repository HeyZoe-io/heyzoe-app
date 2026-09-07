/**
 * C8 milestones / ימים במועדון: activeMembershipsReport → MARKETING check-in
 * on the exact day (member_since + delay_days). Multiple rules (30/90/365)
 * coexist via trigger_id in the sync_log PK. Day-exact, no catch-up, no enqueue.
 *
 * IO (10 businesses): 0 extra activeMemberships GETs when birthday already
 * prefetched the same report in this cron run. +1 GET when C8 is on and birthday
 * is off (no sessionsReport). WhatsApp: one immediate send per matching rule
 * on the exact join+delay day.
 *
 * Seed (arbox_days_in_club_seeded=false): members already at/past X days marked
 * seeded, no WhatsApp. Members not yet at X wait for the exact day.
 * Soft-seed: flag true + empty log for that trigger_id → same past-X mark.
 */
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { ymdDiffDays } from "@/lib/leads/arbox-attendance-gap";
import { parseLeadIdFromUserId } from "@/lib/leads/arbox-all-leads-report";
import {
  fetchArboxActiveMembershipsReport,
  isArboxActiveCustomerMembershipStatus,
} from "@/lib/leads/arbox-customer-set";
import {
  formatDateYmdIsrael,
  isExactDaysAfterEvent,
  nextCancellationSyncLogAfterDispatch,
  parseCancellationSyncAttempts,
  warnAbandonedCancellationSyncLog,
  type CancellationSyncLogStatus,
} from "@/lib/leads/arbox-membership-cancelled";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledMilestonesTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export const DAYS_IN_CLUB_SOFT_SEED_SENTINEL_USER_ID = 0;
export const DAYS_IN_CLUB_SOFT_SEED_SENTINEL_MEMBER_SINCE = "1970-01-01";

export type ArboxDaysInClubRow = {
  user_id?: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  member_since?: unknown;
  start_date?: unknown;
  status?: unknown;
};

export type DaysInClubMember = {
  userId: number;
  memberSinceYmd: string;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
};

export type DaysInClubDispatch =
  | "immediate"
  | "gated"
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "send_failed";

export type DaysInClubSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched: number;
  pages_fetched: number;
  members: number;
  due: number;
  seeded: number;
  soft_seeded: number;
  processed: number;
  already: number;
  notified: number;
  gated: number;
  no_phone: number;
  abandoned: number;
  errors: number;
  fetch_error?: string;
};

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

/** Club join date from the report. Ignores start_date (renewals move it). */
export function parseMemberSinceYmd(raw: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw ?? "").trim());
  return m?.[1] ?? null;
}

export function memberSinceFromMembershipRow(
  row: Pick<ArboxDaysInClubRow, "member_since" | "start_date">
): string | null {
  return parseMemberSinceYmd(row.member_since);
}

/** Catalog minDelayDays is 1 — never fire on join day. */
export function daysInClubDelayDays(raw: unknown): number {
  const n = Math.trunc(Number(raw) || 0);
  return Math.max(1, n);
}

export function isDaysInClubDueToday(input: {
  memberSinceYmd: string;
  todayYmd: string;
  delayDays: number;
}): boolean {
  return isExactDaysAfterEvent({
    eventYmd: input.memberSinceYmd,
    todayYmd: input.todayYmd,
    delayDays: daysInClubDelayDays(input.delayDays),
  });
}

/** First enable / soft-seed: already at or past X → mark seen, no WhatsApp. */
export function shouldSeedDaysInClubMember(input: {
  memberSinceYmd: string;
  todayYmd: string;
  delayDays: number;
}): boolean {
  const days = ymdDiffDays(input.todayYmd, input.memberSinceYmd);
  if (days == null) return false;
  return days >= daysInClubDelayDays(input.delayDays);
}

/** Flag already true + empty log for this trigger_id → soft-seed instead of blasting. */
export function daysInClubNeedsSoftSeed(input: {
  daysInClubSeeded: boolean;
  logCount: number;
}): boolean {
  return input.daysInClubSeeded && input.logCount === 0;
}

export function daysInClubDedupKey(
  triggerId: string,
  userId: number,
  memberSinceYmd: string
): string {
  return `milestones:${triggerId}:${userId}:${memberSinceYmd}`;
}

/**
 * Active memberships with a join date. Punch-card-only customers are not on
 * activeMembershipsReport → they never appear here.
 */
export function collectDaysInClubMembers(
  rows: readonly Record<string, unknown>[]
): DaysInClubMember[] {
  const seen = new Map<string, DaysInClubMember>();
  for (const raw of rows) {
    const row = raw as ArboxDaysInClubRow;
    if (!isArboxActiveCustomerMembershipStatus(row.status)) continue;
    const userId = parseLeadIdFromUserId(row.user_id);
    const memberSinceYmd = memberSinceFromMembershipRow(row);
    if (userId == null || !memberSinceYmd) continue;
    const key = `${userId}:${memberSinceYmd}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      userId,
      memberSinceYmd,
      phone: row.phone,
      full_name: row.full_name,
      first_name: row.first_name,
      last_name: row.last_name,
    });
  }
  return [...seen.values()];
}

function resolveReportFullName(row: {
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
}): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

type ContactRow = {
  id: string;
  phone?: string | null;
  full_name?: string | null;
  arbox_user_id?: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: DaysInClubMember;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const arboxUserId = String(input.row.userId);
  const contactSelect = "id, phone, full_name, arbox_user_id";
  let phoneNorm = normalizePhone(input.row.phone);
  const fullName = resolveReportFullName(input.row);

  let existing: ContactRow | undefined;
  const { data: byUser } = await input.admin
    .from("contacts")
    .select(contactSelect)
    .eq("business_id", input.businessId)
    .eq("arbox_user_id", arboxUserId)
    .order("updated_at", { ascending: false })
    .limit(1);
  existing = byUser?.[0] as ContactRow | undefined;

  if (!phoneNorm && existing) {
    phoneNorm = normalizePhone(existing.phone);
  }

  if (!existing && phoneNorm) {
    const variants = contactPhoneLookupVariants(phoneNorm);
    const { data } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", input.businessId)
      .in("phone", variants.length ? variants : [phoneNorm])
      .order("updated_at", { ascending: false })
      .limit(1);
    existing = data?.[0] as ContactRow | undefined;
  }

  if (existing?.id) {
    phoneNorm = normalizePhone(existing.phone) ?? phoneNorm;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (String(existing.arbox_user_id ?? "").trim() !== arboxUserId) {
      patch.arbox_user_id = arboxUserId;
    }
    if (fullName && !String(existing.full_name ?? "").trim()) patch.full_name = fullName;
    if (Object.keys(patch).length > 1) {
      await input.admin.from("contacts").update(patch).eq("id", existing.id);
    }
    return { contact: existing, phone: phoneNorm };
  }

  if (!phoneNorm) return { contact: null, phone: null };

  const nowIso = new Date().toISOString();
  const { data: inserted, error } = await input.admin
    .from("contacts")
    .insert({
      business_id: input.businessId,
      phone: phoneNorm,
      full_name: fullName,
      source: "arbox_days_in_club",
      arbox_user_id: arboxUserId,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error("[leads/arbox-days-in-club] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertDaysInClubSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  userId: number;
  memberSinceYmd: string;
  contactId: string | null;
  nowIso: string;
  status: CancellationSyncLogStatus;
  attempts: number;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_days_in_club_sync_log").upsert(
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      user_id: input.userId,
      member_since: input.memberSinceYmd,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      status: input.status,
      attempts: input.attempts,
    },
    { onConflict: "business_id,trigger_id,user_id,member_since" }
  );
  if (error) {
    console.error("[leads/arbox-days-in-club] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchDaysInClubTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  rule: PurchaseTemplateTriggerRule;
}): Promise<{ dispatch: DaysInClubDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return { dispatch: "gated", ok: false };

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id, name").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language, components")
      .eq("business_id", input.businessId)
      .eq("name", templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
  ]);

  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!wabaId || !approvedTpl?.id) return { dispatch: "gated", ok: false };

  const firstName = firstNameFromFullName(String(input.fullName ?? ""));
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "milestones",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-days-in-club] template send failed:", sendResult.error);
    return { dispatch: "send_failed", ok: false };
  }

  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(templateName, {
      firstName,
      components: storedComponents,
      bodyParams,
    }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: buildWaSessionId(phoneNumberId, input.phone),
  });

  return { dispatch: "immediate", ok: true };
}

/** True when an enabled milestones rule has a template (cron memberships prefetch). */
export async function businessNeedsDaysInClubSync(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<boolean> {
  const rules = await loadEnabledMilestonesTemplateTriggers(admin, businessId);
  return rules.some((r) => Boolean(r.template_name?.trim()));
}

export async function syncArboxDaysInClubForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  daysInClubSeeded: boolean;
  now?: Date;
  prefetchedMembershipRows?: Record<string, unknown>[];
  prefetchedMembershipPages?: number;
}): Promise<DaysInClubSyncSummary> {
  const summary: DaysInClubSyncSummary = {
    fetched: 0,
    pages_fetched: 0,
    members: 0,
    due: 0,
    seeded: 0,
    soft_seeded: 0,
    processed: 0,
    already: 0,
    notified: 0,
    gated: 0,
    no_phone: 0,
    abandoned: 0,
    errors: 0,
  };

  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const todayYmd = formatDateYmdIsrael(now);

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const rules = await loadEnabledMilestonesTemplateTriggers(input.admin, businessId);
  const rulesWithTemplate = rules.filter((r) => Boolean(r.template_name?.trim()) && r.id);
  if (!rulesWithTemplate.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-days-in-club] skip — no enabled milestones rule", {
      businessId,
      businessSlug,
      dispatch: "no_rule",
    });
    return summary;
  }

  let reportRows: Record<string, unknown>[];
  if (input.prefetchedMembershipRows) {
    reportRows = input.prefetchedMembershipRows;
    summary.pages_fetched = input.prefetchedMembershipPages ?? 0;
  } else {
    const report = await fetchArboxActiveMembershipsReport({
      apiKey,
      boxId,
      now,
    });
    summary.pages_fetched = report.pagesFetched;
    if (!report.ok) {
      summary.fetch_error = report.error;
      summary.errors += 1;
      return summary;
    }
    reportRows = report.rows;
  }
  summary.fetched = reportRows.length;

  const members = collectDaysInClubMembers(reportRows);
  summary.members = members.length;

  async function seedRuleRows(
    rule: PurchaseTemplateTriggerRule,
    kind: "seeded" | "soft_seeded"
  ): Promise<number> {
    let wrote = 0;
    const delayDays = daysInClubDelayDays(rule.delay_days);
    for (const member of members) {
      if (
        !shouldSeedDaysInClubMember({
          memberSinceYmd: member.memberSinceYmd,
          todayYmd,
          delayDays,
        })
      ) {
        continue;
      }
      const marked = await upsertDaysInClubSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        userId: member.userId,
        memberSinceYmd: member.memberSinceYmd,
        contactId: null,
        nowIso,
        status: "seeded",
        attempts: 0,
      });
      if (!marked.ok) {
        summary.errors += 1;
        continue;
      }
      wrote += 1;
      if (kind === "seeded") summary.seeded += 1;
      else summary.soft_seeded += 1;
      console.info("[leads/arbox-days-in-club] dispatch", {
        businessId,
        trigger_id: rule.id,
        user_id: member.userId,
        member_since: member.memberSinceYmd,
        contact: null,
        dispatch: "seeded" satisfies DaysInClubDispatch,
      });
    }
    if (wrote === 0) {
      const sentinel = await upsertDaysInClubSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        userId: DAYS_IN_CLUB_SOFT_SEED_SENTINEL_USER_ID,
        memberSinceYmd: DAYS_IN_CLUB_SOFT_SEED_SENTINEL_MEMBER_SINCE,
        contactId: null,
        nowIso,
        status: "seeded",
        attempts: 0,
      });
      if (sentinel.ok) {
        wrote += 1;
        if (kind === "seeded") summary.seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
    }
    return wrote;
  }

  const needsFullSeed = !input.daysInClubSeeded;
  if (needsFullSeed) {
    for (const rule of rulesWithTemplate) {
      await seedRuleRows(rule, "seeded");
    }
    const { error: flagErr } = await input.admin
      .from("businesses")
      .update({ arbox_days_in_club_seeded: true })
      .eq("id", businessId);
    if (flagErr) {
      console.error("[leads/arbox-days-in-club] seed flag update failed:", flagErr.message);
      summary.errors += 1;
      summary.fetch_error = "arbox_days_in_club_seeded_flag_failed";
    }
    console.info("[leads/arbox-days-in-club] seeded members already past delay", {
      businessId,
      businessSlug,
      seeded: summary.seeded,
    });
    return summary;
  }

  const seededThisRun = new Set<string>();
  for (const rule of rulesWithTemplate) {
    const { count, error } = await input.admin
      .from("arbox_days_in_club_sync_log")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("trigger_id", rule.id);
    if (error) {
      console.error("[leads/arbox-days-in-club] per-trigger seed count failed:", error.message);
      continue;
    }
    if (
      !daysInClubNeedsSoftSeed({
        daysInClubSeeded: true,
        logCount: count ?? 0,
      })
    ) {
      continue;
    }
    await seedRuleRows(rule, "soft_seeded");
    seededThisRun.add(rule.id);
  }

  for (const member of members) {
    if (member.userId === DAYS_IN_CLUB_SOFT_SEED_SENTINEL_USER_ID) continue;

    let resolved: Awaited<ReturnType<typeof resolveOrCreateContact>> | undefined;

    for (const rule of rulesWithTemplate) {
      if (seededThisRun.has(rule.id)) continue;
      const delayDays = daysInClubDelayDays(rule.delay_days);
      if (
        !isDaysInClubDueToday({
          memberSinceYmd: member.memberSinceYmd,
          todayYmd,
          delayDays,
        })
      ) {
        continue;
      }

      summary.due += 1;
      summary.processed += 1;
      const logBase = {
        businessId,
        trigger_id: rule.id,
        user_id: member.userId,
        member_since: member.memberSinceYmd,
      };

      try {
        const { data: existing } = await input.admin
          .from("arbox_days_in_club_sync_log")
          .select("status, attempts, contact_id")
          .eq("business_id", businessId)
          .eq("trigger_id", rule.id)
          .eq("user_id", member.userId)
          .eq("member_since", member.memberSinceYmd)
          .maybeSingle();

        const existingStatus = String((existing as { status?: unknown } | null)?.status ?? "").trim();
        const existingAttempts = parseCancellationSyncAttempts(
          (existing as { attempts?: unknown } | null)?.attempts
        );
        if (existingStatus && existingStatus !== "pending") {
          summary.already += 1;
          console.info("[leads/arbox-days-in-club] dispatch", {
            ...logBase,
            dispatch: "already" satisfies DaysInClubDispatch,
          });
          continue;
        }

        if (!resolved) {
          resolved = await resolveOrCreateContact({
            admin: input.admin,
            businessId,
            row: member,
          });
        }
        const phone = resolved.phone;
        if (!phone) {
          summary.no_phone += 1;
          const marked = await upsertDaysInClubSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: member.userId,
            memberSinceYmd: member.memberSinceYmd,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "no_phone",
            attempts: existingAttempts,
          });
          if (!marked.ok) summary.errors += 1;
          console.info("[leads/arbox-days-in-club] dispatch", {
            ...logBase,
            contact: resolved.contact?.id ?? null,
            dispatch: "no_phone" satisfies DaysInClubDispatch,
          });
          continue;
        }

        const send = await dispatchDaysInClubTemplate({
          admin: input.admin,
          businessId,
          businessSlug,
          phone,
          fullName: resolveReportFullName(member) ?? resolved.contact?.full_name ?? null,
          rule,
        });

        if (send.dispatch === "immediate") summary.notified += 1;
        else if (send.dispatch === "gated") summary.gated += 1;

        console.info("[leads/arbox-days-in-club] dispatch", {
          ...logBase,
          contact: resolved.contact?.id ?? null,
          phone: maskPhoneForLog(phone),
          dispatch: send.dispatch,
        });

        if (
          send.dispatch === "immediate" ||
          send.dispatch === "gated" ||
          send.dispatch === "send_failed"
        ) {
          const next = nextCancellationSyncLogAfterDispatch({
            dispatch: send.dispatch,
            attemptsSoFar: existingAttempts,
          });
          if (next.hitCap) summary.abandoned += 1;
          const marked = await upsertDaysInClubSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: member.userId,
            memberSinceYmd: member.memberSinceYmd,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: next.status,
            attempts: next.attempts,
          });
          if (!marked.ok) summary.errors += 1;
        }
      } catch (e) {
        summary.errors += 1;
        console.error("[leads/arbox-days-in-club] row threw", {
          businessId,
          trigger_id: rule.id,
          user_id: member.userId,
          member_since: member.memberSinceYmd,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  warnAbandonedCancellationSyncLog({
    businessId,
    abandoned: summary.abandoned,
    reason: "send_failed_cap",
  });

  return summary;
}
