/**
 * C7 nth_workout: new members (member_since within lookback ≤30d) who have
 * attended N workouts (check_in="Yes" since join) get a MARKETING check-in.
 * Fire when yesCount >= N, once per (business_id, trigger_id, user_id).
 *
 * IO (10 businesses): 0 extra GETs when birthday/C8 already prefetched
 * activeMemberships and missed/gap already prefetched past bookingsReport.
 * C7-only: +1 memberships +1 bookings (30d). No per-user Arbox calls.
 */
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { parseLeadIdFromUserId } from "@/lib/leads/arbox-all-leads-report";
import { ymdDiffDays } from "@/lib/leads/arbox-attendance-gap";
import {
  fetchArboxActiveMembershipsReport,
} from "@/lib/leads/arbox-customer-set";
import { collectDaysInClubMembers, type DaysInClubMember } from "@/lib/leads/arbox-days-in-club";
import {
  formatDateYmdIsrael,
  nextCancellationSyncLogAfterDispatch,
  parseCancellationSyncAttempts,
  warnAbandonedCancellationSyncLog,
  type CancellationSyncLogStatus,
} from "@/lib/leads/arbox-membership-cancelled";
import {
  bookingsReportSharedLookbackWindow,
} from "@/lib/leads/arbox-missed-class";
import {
  fetchArboxBookingsReport,
  isBookingCheckedIn,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledNthWorkoutTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import {
  NTH_WORKOUT_LOOKBACK_DEFAULT,
  NTH_WORKOUT_LOOKBACK_MAX,
} from "@/lib/trigger-catalog";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export const NTH_WORKOUT_SOFT_SEED_SENTINEL_USER_ID = 0;

export type NthWorkoutDispatch =
  | "immediate"
  | "gated"
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "send_failed";

export type NthWorkoutSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched_memberships: number;
  fetched_bookings: number;
  pages_fetched: number;
  new_members: number;
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

/** delay_days = N (workout count). */
export function nthWorkoutN(raw: unknown): number {
  const n = Math.trunc(Number(raw) || 0);
  return Math.max(1, n);
}

/** lookback_days = new-customer window. null/invalid → 30, cap 30. */
export function nthWorkoutLookbackDays(raw: unknown): number {
  if (raw == null || raw === "") return NTH_WORKOUT_LOOKBACK_DEFAULT;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 1) return NTH_WORKOUT_LOOKBACK_DEFAULT;
  return Math.min(NTH_WORKOUT_LOOKBACK_MAX, n);
}

export function isWithinNewCustomerWindow(input: {
  memberSinceYmd: string;
  todayYmd: string;
  lookbackDays: number;
}): boolean {
  const days = ymdDiffDays(input.todayYmd, input.memberSinceYmd);
  if (days == null || days < 0) return false;
  return days <= nthWorkoutLookbackDays(input.lookbackDays);
}

/** Skip members whose join is older than the fetched bookings window (undercount). */
export function joinDateCoveredByBookingsFetch(
  memberSinceYmd: string,
  bookingsFromYmd: string
): boolean {
  return memberSinceYmd >= bookingsFromYmd;
}

/**
 * Attended workouts since join: check_in="Yes", class_date >= member_since,
 * class_date < today. Rows before join are ignored.
 */
export function countAttendedWorkoutsSinceJoin(input: {
  bookings: readonly ArboxBookingReportRow[];
  userId: number;
  memberSinceYmd: string;
  todayYmd: string;
}): number {
  let count = 0;
  for (const row of input.bookings) {
    const userId = parseLeadIdFromUserId(row.user_id);
    if (userId !== input.userId) continue;
    if (!isBookingCheckedIn(row.check_in)) continue;
    const classDate = parseClassDateYmd(row.date);
    if (!classDate) continue;
    if (classDate < input.memberSinceYmd) continue;
    if (classDate >= input.todayYmd) continue;
    count += 1;
  }
  return count;
}

export function shouldSeedNthWorkout(input: { yesCount: number; n: number }): boolean {
  return input.yesCount >= nthWorkoutN(input.n);
}

/** >= N and no terminal log → send once (catch-up included; log blocks repeats). */
export function shouldSendNthWorkout(input: {
  yesCount: number;
  n: number;
  hasTerminalLog: boolean;
}): boolean {
  if (input.hasTerminalLog) return false;
  return input.yesCount >= nthWorkoutN(input.n);
}

export function nthWorkoutNeedsSoftSeed(input: {
  nthWorkoutSeeded: boolean;
  logCount: number;
}): boolean {
  return input.nthWorkoutSeeded && input.logCount === 0;
}

export function nthWorkoutDedupKey(triggerId: string, userId: number): string {
  return `nth_workout:${triggerId}:${userId}`;
}

/** One row per user_id — keep the latest member_since (current join). */
export function uniqueNthWorkoutMembers(
  members: readonly DaysInClubMember[]
): DaysInClubMember[] {
  const byUser = new Map<number, DaysInClubMember>();
  for (const member of members) {
    const prev = byUser.get(member.userId);
    if (!prev || member.memberSinceYmd > prev.memberSinceYmd) {
      byUser.set(member.userId, member);
    }
  }
  return [...byUser.values()];
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
  member: DaysInClubMember;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const arboxUserId = String(input.member.userId);
  const contactSelect = "id, phone, full_name, arbox_user_id";
  let phoneNorm = normalizePhone(input.member.phone);
  const fullName = resolveReportFullName(input.member);

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
      source: "arbox_nth_workout",
      arbox_user_id: arboxUserId,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error("[leads/arbox-nth-workout] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertNthWorkoutSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  userId: number;
  contactId: string | null;
  nowIso: string;
  status: CancellationSyncLogStatus;
  attempts: number;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_nth_workout_sync_log").upsert(
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      user_id: input.userId,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      status: input.status,
      attempts: input.attempts,
    },
    { onConflict: "business_id,trigger_id,user_id" }
  );
  if (error) {
    console.error("[leads/arbox-nth-workout] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchNthWorkoutTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  rule: PurchaseTemplateTriggerRule;
}): Promise<{ dispatch: NthWorkoutDispatch; ok: boolean }> {
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
    triggerType: "nth_workout",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    workoutN: nthWorkoutN(input.rule.delay_days),
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-nth-workout] template send failed:", sendResult.error);
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

export async function businessNeedsNthWorkoutSync(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<boolean> {
  const rules = await loadEnabledNthWorkoutTemplateTriggers(admin, businessId);
  return rules.some((r) => Boolean(r.template_name?.trim()));
}

export async function syncArboxNthWorkoutForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  nthWorkoutSeeded: boolean;
  now?: Date;
  prefetchedMembershipRows?: Record<string, unknown>[];
  prefetchedMembershipPages?: number;
  prefetchedBookingRows?: ArboxBookingReportRow[];
  prefetchedBookingPages?: number;
  bookingsFromYmd?: string;
  bookingsToYmd?: string;
}): Promise<NthWorkoutSyncSummary> {
  const summary: NthWorkoutSyncSummary = {
    fetched_memberships: 0,
    fetched_bookings: 0,
    pages_fetched: 0,
    new_members: 0,
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

  const rules = await loadEnabledNthWorkoutTemplateTriggers(input.admin, businessId);
  const rulesWithTemplate = rules.filter((r) => Boolean(r.template_name?.trim()) && r.id);
  if (!rulesWithTemplate.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-nth-workout] skip — no enabled nth_workout rule", {
      businessId,
      businessSlug,
      dispatch: "no_rule",
    });
    return summary;
  }

  let membershipRows: Record<string, unknown>[];
  if (input.prefetchedMembershipRows) {
    membershipRows = input.prefetchedMembershipRows;
    summary.pages_fetched += input.prefetchedMembershipPages ?? 0;
  } else {
    const report = await fetchArboxActiveMembershipsReport({ apiKey, boxId, now });
    summary.pages_fetched += report.pagesFetched;
    if (!report.ok) {
      summary.fetch_error = report.error;
      summary.errors += 1;
      return summary;
    }
    membershipRows = report.rows;
  }
  summary.fetched_memberships = membershipRows.length;

  let bookingRows: ArboxBookingReportRow[];
  let bookingsFromYmd = input.bookingsFromYmd ?? "";
  if (input.prefetchedBookingRows) {
    bookingRows = input.prefetchedBookingRows;
    summary.pages_fetched += input.prefetchedBookingPages ?? 0;
  } else {
    const window = bookingsReportSharedLookbackWindow({
      now,
      missedNeedsSeed: false,
      forceWidePast: true,
    });
    const fromDate = window.fromDate;
    const report = await fetchArboxBookingsReport({
      apiKey,
      fromDate,
      toDate: window.toDate,
      locationId: boxId,
    });
    summary.pages_fetched += report.pagesFetched;
    if (!report.ok) {
      summary.fetch_error = report.error;
      summary.errors += 1;
      return summary;
    }
    bookingRows = report.rows;
    bookingsFromYmd = fromDate;
  }
  summary.fetched_bookings = bookingRows.length;
  if (!bookingsFromYmd) {
    bookingsFromYmd = bookingsReportSharedLookbackWindow({
      now,
      missedNeedsSeed: false,
      forceWidePast: true,
    }).fromDate;
  }

  const allMembers = uniqueNthWorkoutMembers(collectDaysInClubMembers(membershipRows));

  async function seedRuleRows(
    rule: PurchaseTemplateTriggerRule,
    kind: "seeded" | "soft_seeded"
  ): Promise<number> {
    const n = nthWorkoutN(rule.delay_days);
    const lookbackDays = nthWorkoutLookbackDays(rule.lookback_days);
    let wrote = 0;
    for (const member of allMembers) {
      if (
        !isWithinNewCustomerWindow({
          memberSinceYmd: member.memberSinceYmd,
          todayYmd,
          lookbackDays,
        })
      ) {
        continue;
      }
      if (!joinDateCoveredByBookingsFetch(member.memberSinceYmd, bookingsFromYmd)) continue;
      const yesCount = countAttendedWorkoutsSinceJoin({
        bookings: bookingRows,
        userId: member.userId,
        memberSinceYmd: member.memberSinceYmd,
        todayYmd,
      });
      if (!shouldSeedNthWorkout({ yesCount, n })) continue;
      const marked = await upsertNthWorkoutSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        userId: member.userId,
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
      console.info("[leads/arbox-nth-workout] dispatch", {
        businessId,
        trigger_id: rule.id,
        user_id: member.userId,
        n,
        yes_count: yesCount,
        dispatch: "seeded" satisfies NthWorkoutDispatch,
      });
    }
    if (wrote === 0) {
      const sentinel = await upsertNthWorkoutSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        userId: NTH_WORKOUT_SOFT_SEED_SENTINEL_USER_ID,
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

  if (!input.nthWorkoutSeeded) {
    for (const rule of rulesWithTemplate) {
      await seedRuleRows(rule, "seeded");
    }
    const { error: flagErr } = await input.admin
      .from("businesses")
      .update({ arbox_nth_workout_seeded: true })
      .eq("id", businessId);
    if (flagErr) {
      console.error("[leads/arbox-nth-workout] seed flag update failed:", flagErr.message);
      summary.errors += 1;
      summary.fetch_error = "arbox_nth_workout_seeded_flag_failed";
    }
    console.info("[leads/arbox-nth-workout] seeded members already at/past N", {
      businessId,
      businessSlug,
      seeded: summary.seeded,
    });
    return summary;
  }

  const seededThisRun = new Set<string>();
  for (const rule of rulesWithTemplate) {
    const { count, error } = await input.admin
      .from("arbox_nth_workout_sync_log")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("trigger_id", rule.id);
    if (error) {
      console.error("[leads/arbox-nth-workout] per-trigger seed count failed:", error.message);
      continue;
    }
    if (
      !nthWorkoutNeedsSoftSeed({
        nthWorkoutSeeded: true,
        logCount: count ?? 0,
      })
    ) {
      continue;
    }
    await seedRuleRows(rule, "soft_seeded");
    seededThisRun.add(rule.id);
  }

  for (const member of allMembers) {
    if (member.userId === NTH_WORKOUT_SOFT_SEED_SENTINEL_USER_ID) continue;

    let resolved: Awaited<ReturnType<typeof resolveOrCreateContact>> | undefined;
    let countedNewMember = false;

    for (const rule of rulesWithTemplate) {
      if (seededThisRun.has(rule.id)) continue;
      const n = nthWorkoutN(rule.delay_days);
      const lookbackDays = nthWorkoutLookbackDays(rule.lookback_days);
      if (
        !isWithinNewCustomerWindow({
          memberSinceYmd: member.memberSinceYmd,
          todayYmd,
          lookbackDays,
        })
      ) {
        continue;
      }
      if (!joinDateCoveredByBookingsFetch(member.memberSinceYmd, bookingsFromYmd)) continue;
      if (!countedNewMember) {
        summary.new_members += 1;
        countedNewMember = true;
      }

      const yesCount = countAttendedWorkoutsSinceJoin({
        bookings: bookingRows,
        userId: member.userId,
        memberSinceYmd: member.memberSinceYmd,
        todayYmd,
      });

      const logBase = {
        businessId,
        trigger_id: rule.id,
        user_id: member.userId,
        n,
        yes_count: yesCount,
      };

      try {
        const { data: existing } = await input.admin
          .from("arbox_nth_workout_sync_log")
          .select("status, attempts, contact_id")
          .eq("business_id", businessId)
          .eq("trigger_id", rule.id)
          .eq("user_id", member.userId)
          .maybeSingle();

        const existingStatus = String((existing as { status?: unknown } | null)?.status ?? "").trim();
        const existingAttempts = parseCancellationSyncAttempts(
          (existing as { attempts?: unknown } | null)?.attempts
        );
        const hasTerminalLog = Boolean(existingStatus && existingStatus !== "pending");

        if (
          !shouldSendNthWorkout({
            yesCount,
            n,
            hasTerminalLog,
          })
        ) {
          if (hasTerminalLog && yesCount >= n) {
            summary.already += 1;
            console.info("[leads/arbox-nth-workout] dispatch", {
              ...logBase,
              dispatch: "already" satisfies NthWorkoutDispatch,
            });
          }
          continue;
        }

        summary.due += 1;
        summary.processed += 1;

        if (!resolved) {
          resolved = await resolveOrCreateContact({
            admin: input.admin,
            businessId,
            member,
          });
        }
        const phone = resolved.phone;
        if (!phone) {
          summary.no_phone += 1;
          const marked = await upsertNthWorkoutSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: member.userId,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "no_phone",
            attempts: existingAttempts,
          });
          if (!marked.ok) summary.errors += 1;
          console.info("[leads/arbox-nth-workout] dispatch", {
            ...logBase,
            contact: resolved.contact?.id ?? null,
            dispatch: "no_phone" satisfies NthWorkoutDispatch,
          });
          continue;
        }

        const send = await dispatchNthWorkoutTemplate({
          admin: input.admin,
          businessId,
          businessSlug,
          phone,
          fullName: resolveReportFullName(member) ?? resolved.contact?.full_name ?? null,
          rule,
        });

        if (send.dispatch === "immediate") summary.notified += 1;
        else if (send.dispatch === "gated") summary.gated += 1;

        console.info("[leads/arbox-nth-workout] dispatch", {
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
          const marked = await upsertNthWorkoutSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: member.userId,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: next.status,
            attempts: next.attempts,
          });
          if (!marked.ok) summary.errors += 1;
        }
      } catch (e) {
        summary.errors += 1;
        console.error("[leads/arbox-nth-workout] row threw", {
          ...logBase,
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
