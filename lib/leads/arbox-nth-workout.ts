/**
 * C7 nth_workout: new members (member_since within lookback ≤30d).
 * After: fire when yesCount >= N (check_in="Yes" since join, date < today).
 * Before: fire once the day before workout N, or the morning of if it is still later today.
 * Evening slot (20:30) runs before-rules only. A booking that appeared after the
 * 09:00 run is still the day before the class, so the evening run sends it.
 * The sync log is shared, so the morning send is not repeated.
 * Once per (business_id, trigger_id, user_id).
 *
 * IO (10 businesses): 0 extra GETs when birthday/C8 already prefetched
 * activeMemberships and missed/gap already prefetched past bookingsReport.
 * C7-only: +1 memberships +1 bookings (30d). A live "before" rule adds one
 * future bookings GET per business per day (skipped when the shared future
 * window already includes today). Evening adds those same GETs again only for
 * a business with a live before rule (~3 GETs; ~30/evening if 10 studios have one).
 * No per-user Arbox calls.
 */
import { logMessage } from "@/lib/analytics";
import { isRetentionStaff, retentionStaffIndex } from "@/lib/leads/arbox-staff";
import { upsertOptionalReason } from "@/lib/leads/sync-log-reason";
import { claimSyncLogBeforeSend } from "@/lib/leads/sync-log-claim";
import {
  decideActivationEventAction,
  eventBeforeRuleActivation,
  israelSlotInstant,
  parseReportEventInstant,
} from "@/lib/rule-activation";
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { parseLeadIdFromUserId } from "@/lib/leads/arbox-all-leads-report";
import { sharedFutureBookingsWindow, ymdDiffDays } from "@/lib/leads/arbox-attendance-gap";
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
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  nthWorkoutTemplateParamValues,
  templateBodyUsesFirstNameSlot,
  templateSendPayload,
} from "@/lib/template-send-params";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import {
  createCompanionSendGate,
  orderAllRulesWithCompanion,
} from "@/lib/same-trigger-template-order";
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
  | "skipped"
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "send_failed"
  | "send_unknown";

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

export type NthWorkoutDirection = "before" | "after";

/** Stored direction. Anything other than before stays the completed-attendance path. */
export function nthWorkoutDirection(raw: unknown): NthWorkoutDirection {
  return String(raw ?? "").trim().toLowerCase() === "before" ? "before" : "after";
}

/**
 * Morning runs every nth_workout rule. Evening runs only before-rules, so a
 * registration after 09:00 still gets the day-before message at 20:30.
 * After-rules stay on the morning run.
 */
export function nthWorkoutRulesForSlot<T extends { delay_direction?: unknown }>(
  rules: readonly T[],
  slot: "morning" | "evening"
): T[] {
  if (slot !== "evening") return [...rules];
  return rules.filter((rule) => nthWorkoutDirection(rule.delay_direction) === "before");
}

export function parseClassMinutes(raw: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function israelNowMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

export function addDaysYmd(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export type BeforeNthWorkoutTarget = {
  classDateYmd: string;
  classTime: string;
};

/**
 * Before workout N: completed attendance is N−1, and the next booking is due.
 * Due = tomorrow (so a morning class is still ahead) or later today if its time
 * has not passed. A class further out waits. Already-attended N does not fire.
 */
export function beforeNthWorkoutTarget(input: {
  bookings: readonly ArboxBookingReportRow[];
  userId: number;
  memberSinceYmd: string;
  todayYmd: string;
  nowMinutes: number;
  n: number;
}): BeforeNthWorkoutTarget | null {
  const n = nthWorkoutN(input.n);
  const attendedSlots = new Set<string>();
  const upcoming = new Map<string, { date: string; time: string; minutes: number }>();
  for (const row of input.bookings) {
    const userId = parseLeadIdFromUserId(row.user_id);
    if (userId !== input.userId) continue;
    const date = parseClassDateYmd(row.date);
    if (!date || date < input.memberSinceYmd) continue;
    const time = String(row.time ?? "").trim();
    const slot = `${date}|${time}`;
    if (isBookingCheckedIn(row.check_in) && date <= input.todayYmd) {
      attendedSlots.add(slot);
      continue;
    }
    if (date < input.todayYmd) continue;
    const minutes = parseClassMinutes(time);
    if (minutes == null) continue;
    if (date === input.todayYmd && minutes <= input.nowMinutes) continue;
    if (!upcoming.has(slot)) upcoming.set(slot, { date, time, minutes });
  }
  for (const slot of attendedSlots) upcoming.delete(slot);
  const completed = attendedSlots.size;
  if (completed !== n - 1) return null;
  const ordered = [...upcoming.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes
  );
  const next = ordered[0];
  if (!next) return null;
  const tomorrow = addDaysYmd(input.todayYmd, 1);
  if (next.date === input.todayYmd || (tomorrow != null && next.date === tomorrow)) {
    return { classDateYmd: next.date, classTime: next.time };
  }
  return null;
}

export function shouldSeedNthWorkout(input: { yesCount: number; n: number }): boolean {
  return input.yesCount >= nthWorkoutN(input.n);
}

/**
 * After-rules count workouts before today, so the message is due at 09:00
 * the next morning. That morning sends. An earlier Nth workout is history.
 * Fewer than N workouts waits for its own morning.
 */
export function nthWorkoutAfterDueAction(input: {
  bookings: readonly ArboxBookingReportRow[];
  userId: number;
  memberSinceYmd: string;
  todayYmd: string;
  n: number;
  now: Date;
}): "seed" | "send" | "later" {
  const workoutN = nthWorkoutN(input.n);
  const dates: string[] = [];
  for (const row of input.bookings) {
    const userId = parseLeadIdFromUserId(row.user_id);
    if (userId !== input.userId) continue;
    if (!isBookingCheckedIn(row.check_in)) continue;
    const classDate = parseClassDateYmd(row.date);
    if (!classDate) continue;
    if (classDate < input.memberSinceYmd) continue;
    if (classDate >= input.todayYmd) continue;
    dates.push(classDate);
  }
  dates.sort();
  const nthDate = dates[workoutN - 1];
  if (!nthDate) return "later";
  const dueYmd = addDaysYmd(nthDate, 1);
  if (!dueYmd || dueYmd > input.todayYmd) return "later";
  const sendAt = israelSlotInstant(dueYmd, "09:00");
  return decideActivationEventAction({ sendAt, now: input.now });
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
  reason?: string | null;
}): Promise<{ ok: boolean }> {
  return upsertOptionalReason(
    input.admin,
    "arbox_nth_workout_sync_log",
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      user_id: input.userId,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      status: input.status,
      attempts: input.attempts,
    },
    "business_id,trigger_id,user_id",
    input.reason,
  );
}

async function dispatchNthWorkoutTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  contactFullName?: string | null;
  rule: PurchaseTemplateTriggerRule;
  classDateYmd?: string | null;
  classTime?: string | null;
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

  const firstName = resolveTemplateFirstName(
    { full_name: input.contactFullName ?? null },
    input.fullName
  );
  if (!firstName && templateBodyUsesFirstNameSlot("nth_workout", (approvedTpl as { components?: unknown }).components)) {
    console.info("[leads/arbox-nth-workout] skip", { reason: "no_valid_name" });
    return { dispatch: "skipped", ok: false };
  }
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const classParams = nthWorkoutTemplateParamValues({
    storedComponents,
    firstName,
    workoutN: nthWorkoutN(input.rule.delay_days),
    classDateYmd: input.classDateYmd,
    classTime: input.classTime,
  });
  if (!classParams.ok) {
    console.info("[leads/arbox-nth-workout] skip", {
      reason: classParams.reason,
      var_count: classParams.varCount,
    });
    return { dispatch: "skipped", ok: false };
  }
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "nth_workout",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    workoutN: nthWorkoutN(input.rule.delay_days),
    classDateYmd: input.classDateYmd,
    classTime: input.classTime,
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    alertTriggerId: input.rule.id,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-nth-workout] template send failed:", sendResult.error);
    return { dispatch: templateFailureDispatch(sendResult.error), ok: false };
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

/** Before-direction needs the shared future bookings window (today…+14). */
export async function nthWorkoutNeedsFutureBookings(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<boolean> {
  const rules = await loadEnabledNthWorkoutTemplateTriggers(admin, businessId);
  return rules.some(
    (rule) =>
      Boolean(rule.template_name?.trim()) && nthWorkoutDirection(rule.delay_direction) === "before"
  );
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
  /** Shared future window (today…+14). Undefined = handler may fetch when a before rule is live. */
  prefetchedFutureRows?: ArboxBookingReportRow[];
  /** Evening runs before-rules only and does not flip the first-enable seed flag. */
  slot?: "morning" | "evening";
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

  const slot = input.slot === "evening" ? "evening" : "morning";
  const rules = await loadEnabledNthWorkoutTemplateTriggers(input.admin, businessId);
  const rulesWithTemplate = nthWorkoutRulesForSlot(orderAllRulesWithCompanion(rules), slot);
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
  const seededAfterUsers = new Set<string>();

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
      if (nthWorkoutDirection(rule.delay_direction) === "after") {
        if (
          nthWorkoutAfterDueAction({
            bookings: bookingRows,
            userId: member.userId,
            memberSinceYmd: member.memberSinceYmd,
            todayYmd,
            n,
            now,
          }) !== "seed"
        ) {
          continue;
        }
        seededAfterUsers.add(`${rule.id}|${member.userId}`);
      } else if (!shouldSeedNthWorkout({ yesCount, n })) {
        continue;
      }
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

  // Evening must not mark the business seeded: that flag also gates after-rules,
  // which stay on the morning run.
  const didFullSeed = slot !== "evening" && !input.nthWorkoutSeeded;
  if (didFullSeed) {
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
  }

  if (!didFullSeed) {
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
    }
  }

  const needsBefore = rulesWithTemplate.some(
    (rule) => nthWorkoutDirection(rule.delay_direction) === "before"
  );
  let futureRows: ArboxBookingReportRow[] = input.prefetchedFutureRows ?? [];
  if (needsBefore && input.prefetchedFutureRows == null) {
    const window = sharedFutureBookingsWindow(now, { includeToday: true });
    const futureReport = await fetchArboxBookingsReport({
      apiKey,
      fromDate: window.fromDate,
      toDate: window.toDate,
      locationId: boxId,
    });
    summary.pages_fetched += futureReport.pagesFetched;
    if (!futureReport.ok) {
      summary.errors += 1;
      summary.fetch_error = futureReport.error;
      console.error("[leads/arbox-nth-workout] future bookings failed", {
        businessId,
        error: futureReport.error,
      });
      futureRows = [];
    } else {
      futureRows = futureReport.rows;
    }
  }
  const nowMinutes = israelNowMinutes(now);
  const staffIndex = await retentionStaffIndex(input.admin, businessId);

  for (const member of allMembers) {
    if (member.userId === NTH_WORKOUT_SOFT_SEED_SENTINEL_USER_ID) continue;

    let resolved: Awaited<ReturnType<typeof resolveOrCreateContact>> | undefined;
    let countedNewMember = false;
    const companionGate = createCompanionSendGate(isArboxDailyDryRun());

    for (const rule of rulesWithTemplate) {
      if (seededAfterUsers.has(`${rule.id}|${member.userId}`)) continue;
      if (eventBeforeRuleActivation(parseReportEventInstant(member.memberSinceYmd), rule)) continue;
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
      const direction = nthWorkoutDirection(rule.delay_direction);
      const beforeTarget =
        direction === "before"
          ? beforeNthWorkoutTarget({
              bookings: [...bookingRows, ...futureRows],
              userId: member.userId,
              memberSinceYmd: member.memberSinceYmd,
              todayYmd,
              nowMinutes,
              n,
            })
          : null;

      const logBase = {
        businessId,
        trigger_id: rule.id,
        user_id: member.userId,
        n,
        yes_count: yesCount,
        direction,
        ...(beforeTarget ? { class_date: beforeTarget.classDateYmd } : {}),
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

        const due =
          direction === "before"
            ? beforeTarget != null && !hasTerminalLog
            : shouldSendNthWorkout({
                yesCount,
                n,
                hasTerminalLog,
              });
        if (!due) {
          if (hasTerminalLog && (direction === "before" ? beforeTarget != null : yesCount >= n)) {
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
        if (isRetentionStaff(staffIndex, { userId: member.userId, phone })) {
          const marked = await upsertNthWorkoutSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: member.userId,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "seeded",
            attempts: existingAttempts,
            reason: "staff",
          });
          if (!marked.ok) summary.errors += 1;
          console.info("[retention-staff] skip", {
            trigger: "nth_workout",
            businessId,
            user_id: member.userId,
          });
          continue;
        }
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

        const templateName = String(rule.template_name ?? "").trim();
        if ((await companionGate.before(templateName)) === "skip") continue;

        if (!isArboxDailyDryRun()) {
          const claimed = await claimSyncLogBeforeSend({
            admin: input.admin,
            table: "arbox_nth_workout_sync_log",
            row: {
              business_id: businessId,
              trigger_id: rule.id,
              user_id: member.userId,
              contact_id: resolved.contact?.id ?? null,
              processed_at: nowIso,
              attempts: existingAttempts,
            },
            filters: [
              ["business_id", businessId],
              ["trigger_id", rule.id],
              ["user_id", member.userId],
            ],
          });
          if (claimed !== "won") {
            if (claimed === "error") summary.errors += 1;
            continue;
          }
        }

        const send = await dispatchNthWorkoutTemplate({
          admin: input.admin,
          businessId,
          businessSlug,
          phone,
          fullName: resolveReportFullName(member),
          contactFullName: resolved.contact?.full_name ?? null,
          rule,
          classDateYmd: beforeTarget?.classDateYmd ?? null,
          classTime: beforeTarget?.classTime ?? null,
        });
        companionGate.after(templateName, send.dispatch);

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
          send.dispatch === "skipped" ||
          (send.dispatch === "send_failed" || send.dispatch === "send_unknown")
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
