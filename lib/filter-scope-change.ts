import { getArboxApiKey } from "@/lib/business-secret-read";
import { fetchAllArboxMembershipTypes, membershipTypeNameById } from "@/lib/arbox-membership-types";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  normalizeMembershipTypeName,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { isMissedClassDatePast, parseClassDateAsEventDate } from "@/lib/leads/arbox-missed-class";
import { postTrialDecisionYmd } from "@/lib/leads/arbox-post-trial-followup";
import {
  addIsraelCalendarDays,
  earlyCutoffNormalSendAt,
  trialReminderNormalSendAt,
  normalizeTrialReminderClassNamePk,
  normalizeTrialReminderClassTimePk,
  parseTrialReminderUserId,
} from "@/lib/leads/arbox-trial-reminder";
import { clientFullNameFromBookingRow } from "@/lib/leads/arbox-trainer-trial-heads-up";
import { normalizePhone } from "@/lib/phone-normalize";
import { decideFilterScopeAction, type FilterScopeAction } from "@/lib/rule-activation";

export { trialReminderNormalSendAt };
import {
  buildMissedClassScheduledDedupKey,
  buildPostTrialFollowupScheduledDedupKey,
  buildTrainerTrialHeadsUpScheduledDedupKey,
  buildTrialAttendedScheduledDedupKey,
  computeDueAt,
} from "@/lib/scheduled-template-sends";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Trial rules with an empty product_filter inherit businesses.arbox_trial_membership_type_ids.
 * A change to either list is a product-filter change for that rule.
 */
const INHERITED_TRIAL_TYPES = new Set<string>([
  "trial_reminder",
  "trial_booked",
  "missed_trial",
  "registered_after_trial",
  "not_registered_after_trial",
  "trial_attended",
  "trainer_trial_heads_up",
]);

const MORNING_HM = "09:00";

export type FilterScopeChangeMode =
  | { kind: "business_trial_ids"; previousIds: number[]; nextIds: number[] }
  | { kind: "rule"; ruleId: string; previousIds: number[]; nextIds: number[] };

export type FilterScopeChangeResult =
  | {
      ok: true;
      seeded: number;
      kept: number;
      pendingSend: number;
      stopped: number;
      rules: number;
    }
  | { ok: false; error: string };

type ScopeRule = {
  id: string;
  trigger_type: string;
  product_filter: number[];
  delay_days: number;
  delay_direction: string;
  template_name: string | null;
};

export function normalizeProductIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.trunc(value))
    ),
  ].sort((a, b) => a - b);
}

export function sameProductIdList(left: unknown, right: unknown): boolean {
  const a = normalizeProductIdList(left);
  const b = normalizeProductIdList(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function israelWall(ymd: string, hm: string): Date | null {
  const dt = new Date(`${ymd}T${hm}:00+03:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function morningOn(ymd: string | null): Date | null {
  return ymd ? israelWall(ymd, MORNING_HM) : null;
}

function aheadOf(now: Date): Date {
  return new Date(now.getTime() + 60_000);
}

function normalSendAt(rule: ScopeRule, classDateYmd: string, classTime: string, now: Date): Date | null {
  const delay = Math.max(0, Math.trunc(rule.delay_days) || 0);
  if (rule.trigger_type === "trial_booked") return null;
  if (rule.trigger_type === "trial_reminder") {
    return trialReminderNormalSendAt({ classDateYmd, classTime, delayDays: delay });
  }
  if (rule.trigger_type === "trainer_trial_heads_up") {
    return earlyCutoffNormalSendAt({ classDateYmd, classTime, delayDays: delay });
  }
  if (rule.trigger_type === "missed_trial" || rule.trigger_type === "trial_attended") {
    if (!isMissedClassDatePast(classDateYmd, now)) return aheadOf(now);
    return computeDueAt(
      { delay_days: delay, delay_direction: rule.delay_direction || "after" },
      parseClassDateAsEventDate(classDateYmd)
    );
  }
  if (
    rule.trigger_type === "registered_after_trial" ||
    rule.trigger_type === "not_registered_after_trial"
  ) {
    return morningOn(postTrialDecisionYmd(classDateYmd, delay));
  }
  return null;
}

function scopeNames(ids: number[], names: Map<number, string>) {
  const trialTypeNamesNormalized = new Set<string>();
  for (const id of ids) {
    const name = names.get(id);
    if (name) trialTypeNamesNormalized.add(normalizeMembershipTypeName(name));
  }
  return { trialTypeIds: ids, trialTypeNamesNormalized };
}

function staffPhone(row: ArboxBookingReportRow): string | null {
  const raw = row.staff_member_phone;
  return normalizePhone(raw) ?? (String(raw ?? "").replace(/\D/g, "").trim() || null);
}

async function cancelPending(admin: Admin, businessId: number, dedupKey: string, nowIso: string): Promise<boolean> {
  const { error } = await admin
    .from("scheduled_template_sends")
    .update({ status: "canceled", last_error: "product_filter_scope", updated_at: nowIso })
    .eq("business_id", businessId)
    .eq("dedup_key", dedupKey)
    .eq("status", "pending");
  if (error) {
    console.error("[filter-scope] cancel pending failed", { businessId, reason: error.message });
    return false;
  }
  return true;
}

async function seedLate(input: {
  admin: Admin;
  businessId: number;
  rule: ScopeRule;
  userId: number;
  classDateYmd: string;
  classTime: string;
  className: string;
  row: ArboxBookingReportRow;
  nowIso: string;
}): Promise<boolean> {
  const { admin, businessId, rule, userId, classDateYmd, classTime, className, row, nowIso } = input;
  if (rule.trigger_type === "trial_reminder") {
    const { error } = await admin.from("arbox_trial_reminder_sync_log").upsert(
      {
        business_id: businessId,
        trigger_id: rule.id,
        user_id: userId,
        class_date: classDateYmd,
        class_time: classTime,
        class_name: className,
        contact_id: null,
        processed_at: nowIso,
        attempts: 0,
        status: "seeded",
      },
      {
        onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name",
        ignoreDuplicates: true,
      }
    );
    return !error;
  }
  if (rule.trigger_type === "trial_booked") {
    const { error } = await admin.from("arbox_trial_booking_confirm_log").upsert(
      {
        business_id: businessId,
        trigger_id: rule.id,
        user_id: userId,
        class_date: classDateYmd,
        class_time: classTime,
        class_name: className,
        status: "seeded",
        attempts: 0,
        confirm_status: "skipped",
        template_status: "skipped",
        channel: "template",
        processed_at: nowIso,
      },
      {
        onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name,channel",
        ignoreDuplicates: true,
      }
    );
    return !error;
  }
  if (rule.trigger_type === "missed_trial") {
    const { error } = await admin.from("arbox_missed_class_sync_log").upsert(
      {
        business_id: businessId,
        trigger_id: rule.id,
        user_id: userId,
        class_date: classDateYmd,
        class_time: classTime,
        class_name: className,
        contact_id: null,
        processed_at: nowIso,
        attempts: 0,
        status: "seeded",
      },
      {
        onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name",
        ignoreDuplicates: true,
      }
    );
    if (error) return false;
    return cancelPending(
      admin,
      businessId,
      buildMissedClassScheduledDedupKey(
        "missed_trial",
        businessId,
        rule.id,
        userId,
        classDateYmd,
        classTime,
        className
      ),
      nowIso
    );
  }
  if (rule.trigger_type === "registered_after_trial" || rule.trigger_type === "not_registered_after_trial") {
    const outcome = rule.trigger_type === "registered_after_trial" ? "registered" : "not_registered";
    const { error } = await admin.from("arbox_post_trial_followup_sync_log").upsert(
      {
        business_id: businessId,
        trigger_id: rule.id,
        user_id: userId,
        class_date: classDateYmd,
        outcome,
        contact_id: null,
        processed_at: nowIso,
        attempts: 0,
        status: "seeded",
      },
      { onConflict: "business_id,trigger_id,user_id,class_date", ignoreDuplicates: true }
    );
    if (error) return false;
    const withName = buildPostTrialFollowupScheduledDedupKey(
      outcome,
      businessId,
      rule.id,
      userId,
      classDateYmd,
      className
    );
    const bare = buildPostTrialFollowupScheduledDedupKey(outcome, businessId, rule.id, userId, classDateYmd);
    const first = await cancelPending(admin, businessId, withName, nowIso);
    if (!first) return false;
    if (bare === withName) return true;
    return cancelPending(admin, businessId, bare, nowIso);
  }
  if (rule.trigger_type === "trial_attended") {
    const { error } = await admin.from("arbox_trial_attended_sync_log").upsert(
      {
        business_id: businessId,
        user_id: userId,
        class_date: classDateYmd,
        contact_id: null,
        processed_at: nowIso,
      },
      { onConflict: "business_id,user_id,class_date", ignoreDuplicates: true }
    );
    if (error) return false;
    return cancelPending(
      admin,
      businessId,
      buildTrialAttendedScheduledDedupKey(businessId, rule.id, userId, classDateYmd),
      nowIso
    );
  }
  if (rule.trigger_type === "trainer_trial_heads_up") {
    const templateName = String(rule.template_name ?? "").trim();
    const trainerPhone = staffPhone(row);
    if (!templateName || !trainerPhone) return true;
    const dedupKey = buildTrainerTrialHeadsUpScheduledDedupKey({
      businessId,
      triggerId: rule.id,
      trainerPhone,
      userId,
      classDateYmd,
      classTime,
      clientFirstName: clientFullNameFromBookingRow(row),
      className,
    });
    const { error } = await admin.from("scheduled_template_sends").upsert(
      {
        business_id: businessId,
        trigger_id: rule.id,
        contact_phone: trainerPhone,
        template_name: templateName,
        due_at: nowIso,
        status: "canceled",
        dedup_key: dedupKey,
        last_error: "product_filter_scope",
        updated_at: nowIso,
      },
      { onConflict: "dedup_key", ignoreDuplicates: true }
    );
    return !error;
  }
  return true;
}

/**
 * Product-filter edits do not move the activation clock.
 * This pass seeds only bookings that newly entered and whose normal send time
 * has already passed, and cancels a pending queue row when a booking leaves.
 * One bookingsReport plus one membership-types GET, only when the id list changes.
 */
export async function applyProductFilterScopeChange(input: {
  admin: Admin;
  businessId: number;
  mode: FilterScopeChangeMode;
  now?: Date;
}): Promise<FilterScopeChangeResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const businessId = Number(input.businessId);
  const counts = { seeded: 0, kept: 0, pendingSend: 0, stopped: 0, rules: 0 };

  const { data: biz, error: bizErr } = await input.admin
    .from("businesses")
    .select("id, crm_api_key, crm_api_key_enc, crm_box_id, arbox_trial_membership_type_ids")
    .eq("id", businessId)
    .maybeSingle();
  if (bizErr || !biz) {
    console.error("[filter-scope] business read failed", { businessId, reason: bizErr?.message ?? "missing" });
    return { ok: false, error: "business_read_failed" };
  }
  const businessIds = normalizeProductIdList(
    (biz as { arbox_trial_membership_type_ids?: unknown }).arbox_trial_membership_type_ids
  );
  const apiKey = getArboxApiKey(biz);
  const boxId = String((biz as { crm_box_id?: unknown }).crm_box_id ?? "").trim();

  let rules: ScopeRule[] = [];
  if (input.mode.kind === "rule") {
    const { data, error } = await input.admin
      .from("template_triggers")
      .select("id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled")
      .eq("id", input.mode.ruleId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (error || !data) {
      console.error("[filter-scope] rule read failed", { businessId, reason: error?.message ?? "missing" });
      return { ok: false, error: "rule_read_failed" };
    }
    const row = data as {
      id: string;
      trigger_type: string;
      product_filter: unknown;
      delay_days: number;
      delay_direction: string;
      template_name: string | null;
      enabled: boolean;
    };
    if (!row.enabled || !INHERITED_TRIAL_TYPES.has(row.trigger_type)) {
      console.info("[filter-scope] non-trial filter edit keeps the activation clock", {
        businessId,
        trigger_type: row.trigger_type,
      });
      return { ok: true, ...counts };
    }
    const previous = input.mode.previousIds.length ? input.mode.previousIds : businessIds;
    const next = input.mode.nextIds.length ? input.mode.nextIds : businessIds;
    rules = [
      {
        id: row.id,
        trigger_type: row.trigger_type,
        product_filter: next,
        delay_days: Number(row.delay_days) || 0,
        delay_direction: String(row.delay_direction ?? "after"),
        template_name: row.template_name,
      },
    ];
    return runRules({
      admin: input.admin,
      businessId,
      apiKey,
      boxId,
      rules,
      previousIds: previous,
      nextIds: next,
      now,
      nowIso,
      counts,
    });
  }

  const { data, error } = await input.admin
    .from("template_triggers")
    .select("id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled")
    .eq("business_id", businessId)
    .eq("enabled", true)
    .in("trigger_type", [...INHERITED_TRIAL_TYPES]);
  if (error) {
    console.error("[filter-scope] rules read failed", { businessId, reason: error.message });
    return { ok: false, error: "rules_read_failed" };
  }
  rules = (data ?? [])
    .map((row) => {
      const item = row as {
        id: string;
        trigger_type: string;
        product_filter: unknown;
        delay_days: number;
        delay_direction: string;
        template_name: string | null;
      };
      return {
        id: item.id,
        trigger_type: item.trigger_type,
        product_filter: normalizeProductIdList(item.product_filter),
        delay_days: Number(item.delay_days) || 0,
        delay_direction: String(item.delay_direction ?? "after"),
        template_name: item.template_name,
      };
    })
    .filter((rule) => rule.product_filter.length === 0);
  if (!rules.length) return { ok: true, ...counts };
  return runRules({
    admin: input.admin,
    businessId,
    apiKey,
    boxId,
    rules,
    previousIds: normalizeProductIdList(input.mode.previousIds),
    nextIds: normalizeProductIdList(input.mode.nextIds),
    now,
    nowIso,
    counts,
  });
}

async function runRules(input: {
  admin: Admin;
  businessId: number;
  apiKey: string;
  boxId: string;
  rules: ScopeRule[];
  previousIds: number[];
  nextIds: number[];
  now: Date;
  nowIso: string;
  counts: { seeded: number; kept: number; pendingSend: number; stopped: number; rules: number };
}): Promise<FilterScopeChangeResult> {
  const { admin, businessId, rules, now, nowIso, counts } = input;
  counts.rules = rules.length;
  if (!input.apiKey || !input.boxId) {
    console.error("[filter-scope] missing arbox credentials", { businessId });
    return { ok: false, error: "missing_credentials" };
  }
  if (sameProductIdList(input.previousIds, input.nextIds)) return { ok: true, ...counts };

  const namesResult = await fetchAllArboxMembershipTypes({
    apiKey: input.apiKey,
    logLabel: "filter-scope",
  });
  if (!namesResult.ok) {
    console.error("[filter-scope] membership types failed", {
      businessId,
      status: namesResult.status,
    });
    return { ok: false, error: "membership_types_failed" };
  }
  const names = membershipTypeNameById(namesResult.types);
  const needed = [...new Set([...input.previousIds, ...input.nextIds])];
  const missing = needed.filter((id) => !names.get(id));
  if (missing.length) {
    console.warn("[filter-scope] catalog has no name for some trial ids; matching those by id only", {
      businessId,
      missing,
    });
  }

  const today = formatDateYmdIsrael(now);
  const pastFrom = addIsraelCalendarDays(today, -30);
  const futureTo = addIsraelCalendarDays(today, 14);
  if (!pastFrom || !futureTo) return { ok: false, error: "bad_window" };
  const reportRows: ArboxBookingReportRow[] = [];
  let pagesFetched = 0;
  for (const [fromDate, toDate] of [
    [pastFrom, today],
    [today, futureTo],
  ] as const) {
    const report = await fetchArboxBookingsReport({
      apiKey: input.apiKey,
      fromDate,
      toDate,
      locationId: input.boxId,
    });
    pagesFetched += report.pagesFetched;
    if (!report.ok) {
      console.error("[filter-scope] bookings report failed", { businessId, fromDate, toDate, reason: report.error });
      return { ok: false, error: report.error };
    }
    reportRows.push(...report.rows);
  }

  const previousScope = scopeNames(input.previousIds, names);
  const nextScope = scopeNames(input.nextIds, names);
  let failed = false;
  const seen = new Set<string>();

  for (const row of reportRows) {
    const userId = parseTrialReminderUserId(row.user_id);
    const classDateYmd = parseClassDateYmd(row.date);
    const classTime = normalizeTrialReminderClassTimePk(row.time);
    const className = normalizeTrialReminderClassNamePk(row.class_name);
    if (userId == null || !classDateYmd || !classTime || !className) continue;
    const grain = `${userId}|${classDateYmd}|${classTime}|${className}`;
    if (seen.has(grain)) continue;
    seen.add(grain);
    const previouslyInScope = bookingMatchesTrialScope(row, previousScope);
    const nowInScope = bookingMatchesTrialScope(row, nextScope);
    if (!previouslyInScope && !nowInScope) continue;

    for (const rule of rules) {
      const action: FilterScopeAction = decideFilterScopeAction({
        previouslyInScope,
        nowInScope,
        sendAt: normalSendAt(rule, classDateYmd, classTime, now),
        now,
      });
      if (action === "keep") {
        counts.kept += 1;
        continue;
      }
      if (action === "send") {
        counts.pendingSend += 1;
        continue;
      }
      if (action === "stop") {
        counts.stopped += 1;
        const stoppedOk = await stopQueued({
          admin,
          businessId,
          rule,
          userId,
          classDateYmd,
          classTime,
          className,
          row,
          nowIso,
        });
        if (!stoppedOk) failed = true;
        continue;
      }
      const seededOk = await seedLate({
        admin,
        businessId,
        rule,
        userId,
        classDateYmd,
        classTime,
        className,
        row,
        nowIso,
      });
      if (!seededOk) {
        failed = true;
        console.error("[filter-scope] seed failed", {
          businessId,
          trigger_type: rule.trigger_type,
          user_id: userId,
          class_date: classDateYmd,
        });
      } else counts.seeded += 1;
    }
  }

  if (failed) return { ok: false, error: "filter_scope_write_failed" };
  console.info("[filter-scope] product filter applied without resetting activation", {
    businessId,
    rules: counts.rules,
    seeded: counts.seeded,
    kept: counts.kept,
    pending_send: counts.pendingSend,
    stopped: counts.stopped,
    bookings: reportRows.length,
    pages: pagesFetched,
  });
  return { ok: true, ...counts };
}

async function stopQueued(input: {
  admin: Admin;
  businessId: number;
  rule: ScopeRule;
  userId: number;
  classDateYmd: string;
  classTime: string;
  className: string;
  row: ArboxBookingReportRow;
  nowIso: string;
}): Promise<boolean> {
  const { admin, businessId, rule, userId, classDateYmd, classTime, className, row, nowIso } = input;
  if (rule.trigger_type === "missed_trial") {
    return cancelPending(
      admin,
      businessId,
      buildMissedClassScheduledDedupKey(
        "missed_trial",
        businessId,
        rule.id,
        userId,
        classDateYmd,
        classTime,
        className
      ),
      nowIso
    );
  }
  if (rule.trigger_type === "registered_after_trial" || rule.trigger_type === "not_registered_after_trial") {
    const outcome = rule.trigger_type === "registered_after_trial" ? "registered" : "not_registered";
    const withName = buildPostTrialFollowupScheduledDedupKey(
      outcome,
      businessId,
      rule.id,
      userId,
      classDateYmd,
      className
    );
    const bare = buildPostTrialFollowupScheduledDedupKey(outcome, businessId, rule.id, userId, classDateYmd);
    const first = await cancelPending(admin, businessId, withName, nowIso);
    if (!first || bare === withName) return first;
    return cancelPending(admin, businessId, bare, nowIso);
  }
  if (rule.trigger_type === "trial_attended") {
    return cancelPending(
      admin,
      businessId,
      buildTrialAttendedScheduledDedupKey(businessId, rule.id, userId, classDateYmd),
      nowIso
    );
  }
  if (rule.trigger_type === "trainer_trial_heads_up") {
    const trainerPhone = staffPhone(row);
    if (!trainerPhone) return true;
    return cancelPending(
      admin,
      businessId,
      buildTrainerTrialHeadsUpScheduledDedupKey({
        businessId,
        triggerId: rule.id,
        trainerPhone,
        userId,
        classDateYmd,
        classTime,
        clientFirstName: clientFullNameFromBookingRow(row),
        className,
      }),
      nowIso
    );
  }
  return true;
}
