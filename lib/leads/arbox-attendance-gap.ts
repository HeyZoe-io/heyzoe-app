/**
 * attendance_gap: days since last check_in="Yes" with no future-booking split.
 * (Former C2 only — C1 booked path removed; messaging someone already booked is noise.)
 * Tiers = template_triggers.delay_days (7/14/21). Dedup includes gap_start_date for re-entry.
 * sync_log still stores variant='unbooked' (PK column kept; no migration).
 */
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import {
  nextCancellationSyncLogAfterDispatch,
  parseCancellationSyncAttempts,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import {
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  isBookingCheckedIn,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildAttendanceGapScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledAttendanceGapTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Past window for last Yes (Arbox report span cap). Gaps older than this are out of scope. */
export const ATTENDANCE_GAP_PAST_SPAN_DAYS = 30;
/**
 * Future bookings horizon used by freeze ending (C14/C15) shared cron prefetch.
 * Attendance gap itself no longer fetches future bookings.
 */
export const ATTENDANCE_GAP_FUTURE_SPAN_DAYS = 14;

/** Fixed sync_log variant — column kept in PK; booked path removed. */
export const ATTENDANCE_GAP_SYNC_VARIANT = "unbooked" as const;

export type AttendanceGapTriggerType = "attendance_gap";

export type AttendanceGapUserState = {
  userId: number;
  lastYesYmd: string;
  gapDays: number;
  /** Any past row used for phone / name resolution. */
  sampleRow: ArboxBookingReportRow;
};

export type AttendanceGapSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  lookback_from?: string;
  lookback_to?: string;
  fetched_past: number;
  pages_fetched: number;
  users_with_gap: number;
  seeded: number;
  soft_seeded: number;
  processed: number;
  already: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  abandoned: number;
  errors: number;
  fetch_error?: string;
};

export function attendanceGapPastWindow(now: Date = new Date()): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(now);
  const [y, m, d] = toDate.split("-").map((n) => Number(n));
  const toUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const fromUtc = new Date(toUtc.getTime() - (ATTENDANCE_GAP_PAST_SPAN_DAYS - 1) * MS_PER_DAY);
  const yy = fromUtc.getUTCFullYear();
  const mm = String(fromUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fromUtc.getUTCDate()).padStart(2, "0");
  return { fromDate: `${yy}-${mm}-${dd}`, toDate };
}

/**
 * Shared future bookingsReport window (freeze ending + trial_reminder).
 * includeToday=false → today+1 … today+14 (freeze ending; class today is not "future").
 * includeToday=true → today … today+14 (trial_reminder delay 0 = morning of class).
 */
export function sharedFutureBookingsWindow(
  now: Date = new Date(),
  opts?: { includeToday?: boolean }
): {
  fromDate: string;
  toDate: string;
} {
  const today = formatDateYmdIsrael(now);
  const [y, m, d] = today.split("-").map((n) => Number(n));
  const todayUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const fromUtc = opts?.includeToday
    ? todayUtc
    : new Date(todayUtc.getTime() + MS_PER_DAY);
  const toUtc = new Date(todayUtc.getTime() + ATTENDANCE_GAP_FUTURE_SPAN_DAYS * MS_PER_DAY);
  const fmt = (dt: Date) => {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };
  return { fromDate: fmt(fromUtc), toDate: fmt(toUtc) };
}

/** Shared with freeze ending cron prefetch (today+1 … today+14). */
export function attendanceGapFutureWindow(now: Date = new Date()): {
  fromDate: string;
  toDate: string;
} {
  return sharedFutureBookingsWindow(now, { includeToday: false });
}

export function ymdDiffDays(laterYmd: string, earlierYmd: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(laterYmd);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(earlierYmd);
  if (!a || !b) return null;
  const later = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]), 12, 0, 0);
  const earlier = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]), 12, 0, 0);
  return Math.round((later - earlier) / MS_PER_DAY);
}

export function parseAttendanceGapUserId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/**
 * After the business seed flag is true: tiers with zero sync_log rows need soft-seed
 * (mark current cohort, no WhatsApp). Empty cohort still needs a one-shot sentinel.
 */
export function attendanceGapTiersNeedingSoftSeed(input: {
  attendanceGapSeeded: boolean;
  configuredTiers: readonly number[];
  tiersWithAnySyncLog: ReadonlySet<number>;
}): number[] {
  if (!input.attendanceGapSeeded) return [];
  return input.configuredTiers.filter((t) => !input.tiersWithAnySyncLog.has(t));
}

/** Users in a seed/soft-seed pass for one tier (no WhatsApp). */
export function attendanceGapSeedCandidates(input: {
  states: readonly AttendanceGapUserState[];
  tier: number;
}): AttendanceGapUserState[] {
  return input.states.filter((s) => s.gapDays >= input.tier);
}

/**
 * Per-user last real attendance (check_in Yes only — registration/No does not count).
 * No future-booking filter: anyone past the absence tier is a candidate.
 */
export function computeAttendanceGapStates(input: {
  pastRows: readonly ArboxBookingReportRow[];
  todayYmd: string;
}): AttendanceGapUserState[] {
  type Acc = {
    lastYesYmd: string | null;
    sampleRow: ArboxBookingReportRow | null;
  };
  const pastByUser = new Map<number, Acc>();

  for (const row of input.pastRows) {
    const userId = parseAttendanceGapUserId(row.user_id);
    const classDateYmd = parseClassDateYmd(row.date);
    if (userId == null || !classDateYmd) continue;
    if (classDateYmd >= input.todayYmd) continue;

    let acc = pastByUser.get(userId);
    if (!acc) {
      acc = { lastYesYmd: null, sampleRow: row };
      pastByUser.set(userId, acc);
    } else if (!acc.sampleRow) {
      acc.sampleRow = row;
    }

    if (!isBookingCheckedIn(row.check_in)) continue;
    if (!acc.lastYesYmd || classDateYmd > acc.lastYesYmd) {
      acc.lastYesYmd = classDateYmd;
      acc.sampleRow = row;
    }
  }

  const out: AttendanceGapUserState[] = [];
  for (const [userId, past] of pastByUser) {
    if (!past.lastYesYmd || !past.sampleRow) continue;
    const gapDays = ymdDiffDays(input.todayYmd, past.lastYesYmd);
    if (gapDays == null || gapDays < 1) continue;
    out.push({
      userId,
      lastYesYmd: past.lastYesYmd,
      gapDays,
      sampleRow: past.sampleRow,
    });
  }
  return out;
}

function resolveReportFullName(row: ArboxBookingReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

type ContactRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  arbox_user_id: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxBookingReportRow;
  source: string;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const contactSelect = "id, phone, full_name, arbox_user_id";
  const arboxUserId = String(input.row.user_id ?? "").trim();
  let phoneNorm = normalizePhone(input.row.phone);
  const fullName = resolveReportFullName(input.row);

  let existing: ContactRow | undefined;
  if (arboxUserId) {
    const { data } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", input.businessId)
      .eq("arbox_user_id", arboxUserId)
      .order("updated_at", { ascending: false })
      .limit(1);
    existing = data?.[0] as ContactRow | undefined;
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
    if (arboxUserId && String(existing.arbox_user_id ?? "").trim() !== arboxUserId) {
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
      source: input.source,
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();
  if (error || !inserted) {
    console.error("[leads/arbox-attendance-gap] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertGapSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  userId: number;
  gapStartDate: string;
  tier: number;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_attendance_gap_sync_log").upsert(
    {
      business_id: input.businessId,
      user_id: input.userId,
      variant: ATTENDANCE_GAP_SYNC_VARIANT,
      gap_start_date: input.gapStartDate,
      tier: input.tier,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    { onConflict: "business_id,user_id,variant,gap_start_date,tier" }
  );
  if (error) {
    console.error("[leads/arbox-attendance-gap] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchGapTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  userId: number;
  gapStartDate: string;
  tier: number;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: "immediate" | "deferred" | "gated" | "send_failed" | "no_rule"; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  // Tier lives in delay_days; send is immediate on detection day (not event+N).
  const dueAt = computeDueAt({ delay_days: 0, delay_direction: "after" }, input.now);

  if (dueAt.getTime() > input.now.getTime() + 15_000) {
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildAttendanceGapScheduledDedupKey(
        input.businessId,
        input.rule.id,
        input.userId,
        input.gapStartDate,
        input.tier
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-attendance-gap] enqueue failed:", enqueueResult.error);
      return { dispatch: "send_failed", ok: false };
    }
    return { dispatch: "deferred", ok: true };
  }

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
    triggerType: "attendance_gap",
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
    console.error("[leads/arbox-attendance-gap] template send failed:", sendResult.error);
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

function normalizeTiersFromRules(rules: PurchaseTemplateTriggerRule[]): number[] {
  const tiers = new Set<number>();
  for (const r of rules) {
    if (!r.template_name?.trim()) continue;
    const t = Math.max(1, Math.trunc(Number(r.delay_days) || 0));
    tiers.add(t);
  }
  return [...tiers].sort((a, b) => a - b);
}

function pickRuleForTier(
  rules: PurchaseTemplateTriggerRule[],
  tier: number
): PurchaseTemplateTriggerRule | null {
  const matching = rules
    .filter((r) => r.template_name?.trim() && Math.max(1, Math.trunc(Number(r.delay_days) || 0)) === tier)
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  return matching[0] ?? null;
}

/** Soft-seed: tiers with zero sync_log rows for this business after global seed. */
export async function findAttendanceGapTiersNeedingSoftSeed(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  tiers: number[];
}): Promise<number[]> {
  const withRows = new Set<number>();
  for (const tier of input.tiers) {
    const { count, error } = await input.admin
      .from("arbox_attendance_gap_sync_log")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .eq("variant", ATTENDANCE_GAP_SYNC_VARIANT)
      .eq("tier", tier);
    if (error) {
      console.error("[leads/arbox-attendance-gap] soft-seed count failed:", error.message);
      continue;
    }
    if ((count ?? 0) > 0) withRows.add(tier);
  }
  return attendanceGapTiersNeedingSoftSeed({
    attendanceGapSeeded: true,
    configuredTiers: input.tiers,
    tiersWithAnySyncLog: withRows,
  });
}

export async function syncArboxAttendanceGapForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  attendanceGapSeeded: boolean;
  now?: Date;
  /** Past bookingsReport rows (shared cron prefetch preferred). */
  prefetchedPastRows?: ArboxBookingReportRow[];
  prefetchedPastPages?: number;
  lookbackFrom?: string;
  lookbackTo?: string;
}): Promise<AttendanceGapSyncSummary> {
  const summary: AttendanceGapSyncSummary = {
    fetched_past: 0,
    pages_fetched: 0,
    users_with_gap: 0,
    seeded: 0,
    soft_seeded: 0,
    processed: 0,
    already: 0,
    notified: 0,
    deferred: 0,
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

  const rules = await loadEnabledAttendanceGapTemplateTriggers(input.admin, businessId);
  const tiers = normalizeTiersFromRules(rules);
  if (!tiers.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  let pastRows: ArboxBookingReportRow[];
  if (input.prefetchedPastRows) {
    pastRows = input.prefetchedPastRows;
    summary.pages_fetched = input.prefetchedPastPages ?? 0;
    summary.lookback_from = input.lookbackFrom;
    summary.lookback_to = input.lookbackTo;
  } else {
    const pastWindow = attendanceGapPastWindow(now);
    summary.lookback_from = pastWindow.fromDate;
    summary.lookback_to = pastWindow.toDate;
    const pastReport = await fetchArboxBookingsReport({
      apiKey,
      fromDate: pastWindow.fromDate,
      toDate: pastWindow.toDate,
      locationId: boxId,
    });
    summary.pages_fetched = pastReport.pagesFetched;
    if (!pastReport.ok) {
      summary.fetch_error = pastReport.error;
      summary.errors += 1;
      return summary;
    }
    pastRows = pastReport.rows;
  }
  summary.fetched_past = pastRows.length;

  const states = computeAttendanceGapStates({
    pastRows,
    todayYmd,
  });
  summary.users_with_gap = states.length;

  let seedTiers: number[] = [];
  if (!input.attendanceGapSeeded) {
    seedTiers = tiers;
  } else {
    seedTiers = await findAttendanceGapTiersNeedingSoftSeed({
      admin: input.admin,
      businessId,
      tiers,
    });
  }

  const isFullSeed = !input.attendanceGapSeeded;

  for (const tier of seedTiers) {
    let wroteForTier = 0;
    for (const state of attendanceGapSeedCandidates({ states, tier })) {
      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row: state.sampleRow,
        source: "arbox_attendance_gap_seed",
      });
      const up = await upsertGapSyncLog({
        admin: input.admin,
        businessId,
        userId: state.userId,
        gapStartDate: state.lastYesYmd,
        tier,
        contactId: resolved.contact?.id ?? null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (up.ok) {
        wroteForTier += 1;
        if (isFullSeed) summary.seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
    }
    // Soft-seed must be one-shot even with an empty cohort.
    if (!isFullSeed && wroteForTier === 0) {
      const sentinel = await upsertGapSyncLog({
        admin: input.admin,
        businessId,
        userId: 0,
        gapStartDate: todayYmd,
        tier,
        contactId: null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (sentinel.ok) summary.soft_seeded += 1;
      else summary.errors += 1;
    }
  }

  if (isFullSeed) {
    const { error: seedFlagErr } = await input.admin
      .from("businesses")
      .update({ arbox_attendance_gap_seeded: true })
      .eq("id", businessId);
    if (seedFlagErr) {
      console.error("[leads/arbox-attendance-gap] seed flag update failed:", seedFlagErr.message);
      summary.errors += 1;
    }
    console.info("[leads/arbox-attendance-gap] seeded current gaps", {
      businessId,
      businessSlug,
      seeded: summary.seeded,
    });
    return summary;
  }

  if (seedTiers.length) {
    console.info("[leads/arbox-attendance-gap] soft-seeded new tiers", {
      businessId,
      businessSlug,
      soft_seeded: summary.soft_seeded,
      tiers: seedTiers,
    });
  }

  for (const state of states) {
    for (const tier of tiers) {
      if (state.gapDays < tier) continue;
      if (seedTiers.includes(tier)) continue;

      const rule = pickRuleForTier(rules, tier);
      if (!rule) continue;

      try {
        const { data: existing } = await input.admin
          .from("arbox_attendance_gap_sync_log")
          .select("status, attempts, contact_id")
          .eq("business_id", businessId)
          .eq("user_id", state.userId)
          .eq("variant", ATTENDANCE_GAP_SYNC_VARIANT)
          .eq("gap_start_date", state.lastYesYmd)
          .eq("tier", tier)
          .maybeSingle();

        const status = String((existing as { status?: unknown } | null)?.status ?? "");
        if (status === "seeded" || status === "sent" || status === "abandoned" || status === "no_phone") {
          summary.already += 1;
          continue;
        }
        const attemptsSoFar = parseCancellationSyncAttempts(
          (existing as { attempts?: unknown } | null)?.attempts
        );

        const resolved = await resolveOrCreateContact({
          admin: input.admin,
          businessId,
          row: state.sampleRow,
          source: "arbox_attendance_gap",
        });
        if (!resolved.phone || !resolved.contact?.id) {
          summary.no_phone += 1;
          await upsertGapSyncLog({
            admin: input.admin,
            businessId,
            userId: state.userId,
            gapStartDate: state.lastYesYmd,
            tier,
            contactId: resolved.contact?.id ?? null,
            attempts: attemptsSoFar,
            status: "no_phone",
            nowIso,
          });
          continue;
        }

        const send = await dispatchGapTemplate({
          admin: input.admin,
          businessId,
          businessSlug,
          phone: resolved.phone,
          fullName: resolveReportFullName(state.sampleRow) ?? resolved.contact.full_name ?? null,
          userId: state.userId,
          gapStartDate: state.lastYesYmd,
          tier,
          rule,
          now,
        });

        const mapped =
          send.dispatch === "immediate"
            ? ("immediate" as const)
            : send.dispatch === "deferred"
              ? ("deferred" as const)
              : send.dispatch === "gated"
                ? ("gated" as const)
                : send.dispatch === "send_failed"
                  ? ("send_failed" as const)
                  : ("gated" as const);

        const next = nextCancellationSyncLogAfterDispatch({
          dispatch: mapped,
          attemptsSoFar,
        });
        await upsertGapSyncLog({
          admin: input.admin,
          businessId,
          userId: state.userId,
          gapStartDate: state.lastYesYmd,
          tier,
          contactId: resolved.contact.id,
          attempts: next.attempts,
          status: next.status,
          nowIso,
        });

        summary.processed += 1;
        if (send.dispatch === "immediate") summary.notified += 1;
        else if (send.dispatch === "deferred") summary.deferred += 1;
        else if (send.dispatch === "gated") summary.gated += 1;
        else if (send.dispatch === "send_failed") {
          if (next.hitCap) summary.abandoned += 1;
          else summary.errors += 1;
        }

        console.info("[leads/arbox-attendance-gap] dispatch", {
          businessId,
          tier,
          user_id: state.userId,
          gap_days: state.gapDays,
          gap_start: state.lastYesYmd,
          contact: maskPhoneForLog(resolved.phone),
          dispatch: send.dispatch,
          status: next.status,
        });
      } catch (e) {
        summary.errors += 1;
        console.error("[leads/arbox-attendance-gap] row threw", {
          businessId,
          user_id: state.userId,
          tier,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  warnAbandonedCancellationSyncLog({
    businessId,
    abandoned: summary.abandoned,
    reason: "attendance_gap_send_failed_cap",
  });

  return summary;
}
