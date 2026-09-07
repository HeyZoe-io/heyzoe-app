/**
 * A7 lost_lead win-back: lostLeadsReport → MARKETING template on the exact due day
 * (delay_days after lost_date). Multiple rules (day 1 / 7 / 21) replace a D3 state machine.
 * Re-fetch each cron run: if the lead left the report (came back / joined), later steps do not send.
 * Seed 30d without WhatsApp; after seed lookback = max(3, max delay) capped at 30.
 */
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import {
  formatDateYmdIsrael,
  isExactDaysAfterEvent,
  lookbackDaysForSequenceDelays,
  nextCancellationSyncLogAfterDispatch,
  parseCancellationSyncAttempts,
  parseCancelledEventDate,
  reportTimestampToYmd,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import { fetchLostLeadsReportRows } from "@/lib/leads/arbox-lost-leads-report";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledLostLeadTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** First-run / soft-seed window — Arbox reports reject spans over 31 days. */
export const LOST_LEAD_SEED_SPAN_DAYS = 30;
/** After seed: fromDate = today − this many days (late rows still appear). */
export const LOST_LEAD_LOOKBACK_DAYS = 3;

export const LOST_LEAD_SOFT_SEED_SENTINEL_LEAD_ID = 0;
export const LOST_LEAD_SOFT_SEED_SENTINEL_LOST_DATE = "1970-01-01";

export type ArboxLostLeadRow = {
  lead_id?: unknown;
  user_id?: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  lost_date?: unknown;
  lost_reason_name?: unknown;
  created_at?: unknown;
  source_name?: unknown;
};

export type LostLeadDispatch =
  | "immediate"
  | "deferred"
  | "gated"
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "send_failed";

export type LostLeadSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched: number;
  pages_fetched: number;
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

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

/** Trimmed report lost_date — PK grain. Empty → not a valid lost-lead event. */
export function normalizeLostDatePk(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

/** lead_id from the report (same as user_id). Prefer lead_id, then user_id. */
export function parseLostLeadId(row: Pick<ArboxLostLeadRow, "lead_id" | "user_id">): number | null {
  const fromLead = parsePositiveInt(row.lead_id);
  if (fromLead != null) return fromLead;
  return parsePositiveInt(row.user_id);
}

function parsePositiveInt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function parseLostEventDate(raw: unknown, now: Date = new Date()): Date {
  return parseCancelledEventDate(raw, now);
}

export function seedLostLeadReportDateRange(now: Date): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(now);
  const fromDate = formatDateYmdIsrael(
    new Date(now.getTime() - LOST_LEAD_SEED_SPAN_DAYS * MS_PER_DAY)
  );
  return { fromDate, toDate };
}

export function lostLeadReportDateRange(input: {
  seeded: boolean;
  now: Date;
  lookbackDays?: number;
}): { fromDate: string; toDate: string } {
  if (!input.seeded) return seedLostLeadReportDateRange(input.now);
  const toDate = formatDateYmdIsrael(input.now);
  const days = Math.max(
    LOST_LEAD_LOOKBACK_DAYS,
    Math.trunc(input.lookbackDays ?? LOST_LEAD_LOOKBACK_DAYS)
  );
  const fromDate = formatDateYmdIsrael(new Date(input.now.getTime() - days * MS_PER_DAY));
  return { fromDate, toDate };
}

/** Flag already true + empty log → soft-seed (rule added later) instead of blasting. */
export function lostLeadNeedsSoftSeed(input: {
  lostLeadSeeded: boolean;
  logCount: number;
}): boolean {
  return input.lostLeadSeeded && input.logCount === 0;
}

function resolveReportFullName(row: ArboxLostLeadRow): string | null {
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
  row: ArboxLostLeadRow;
  leadId: number;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const arboxUserId = String(input.leadId);
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
      source: "arbox_lost_lead",
      arbox_user_id: arboxUserId,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error("[leads/arbox-lost-lead] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertLostLeadSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  leadId: number;
  lostDate: string;
  contactId: string | null;
  nowIso: string;
  status: CancellationSyncLogStatus;
  attempts: number;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_lost_lead_sync_log").upsert(
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      lead_id: input.leadId,
      lost_date: input.lostDate,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      status: input.status,
      attempts: input.attempts,
    },
    { onConflict: "business_id,trigger_id,lead_id,lost_date" }
  );
  if (error) {
    console.error("[leads/arbox-lost-lead] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchLostLeadTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  leadId: number;
  lostDate: string;
  rule: PurchaseTemplateTriggerRule;
}): Promise<{ dispatch: LostLeadDispatch; ok: boolean }> {
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
    triggerType: "lost_lead",
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
    console.error("[leads/arbox-lost-lead] template send failed:", sendResult.error);
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

/**
 * Daily lost_lead step for one Arbox business.
 *
 * IO (10 businesses): 1 lostLeadsReport GET each when an enabled rule with
 * template_name exists (paginated; typically 1 page after seed). No per-lead
 * Arbox calls. WhatsApp/Meta: one immediate send per matching rule on its due day.
 *
 * Seed (arbox_lost_lead_seeded=false): mark the 30-day window seen, no WhatsApp.
 * Soft-seed: flag true + empty log for that trigger_id → same 30-day mark, no WhatsApp.
 */
export async function syncArboxLostLeadForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  lostLeadSeeded: boolean;
  now?: Date;
}): Promise<LostLeadSyncSummary> {
  const summary: LostLeadSyncSummary = {
    fetched: 0,
    pages_fetched: 0,
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

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const rules = await loadEnabledLostLeadTemplateTriggers(input.admin, businessId);
  const rulesWithTemplate = rules.filter((r) => Boolean(r.template_name?.trim()));
  if (!rulesWithTemplate.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-lost-lead] skip — no enabled lost_lead rule", {
      businessId,
      businessSlug,
    });
    return summary;
  }

  const lookbackDays = lookbackDaysForSequenceDelays(
    rulesWithTemplate.map((r) => r.delay_days),
    LOST_LEAD_LOOKBACK_DAYS
  );
  const needsFullSeed = !input.lostLeadSeeded;
  const { fromDate, toDate } = lostLeadReportDateRange({
    seeded: !needsFullSeed,
    now,
    lookbackDays,
  });

  const report = await fetchLostLeadsReportRows({
    apiKey,
    fromDate,
    toDate,
    locationId: boxId,
  });
  summary.pages_fetched = report.pagesFetched;
  if (!report.ok) {
    summary.fetch_error = report.error;
    summary.errors += 1;
    return summary;
  }
  summary.fetched = report.rows.length;
  const reportRows = report.rows;
  const todayYmd = formatDateYmdIsrael(now);

  async function seedRuleRows(
    rule: PurchaseTemplateTriggerRule,
    kind: "seeded" | "soft_seeded"
  ): Promise<number> {
    let wrote = 0;
    for (const raw of reportRows) {
      const row = raw as ArboxLostLeadRow;
      const leadId = parseLostLeadId(row);
      const lostDate = normalizeLostDatePk(row.lost_date);
      if (leadId == null || !lostDate) continue;
      const marked = await upsertLostLeadSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        leadId,
        lostDate,
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
      console.info("[leads/arbox-lost-lead] dispatch", {
        businessId,
        trigger_id: rule.id,
        lead_id: leadId,
        lost_date: lostDate,
        contact: null,
        dispatch: "seeded" satisfies LostLeadDispatch,
      });
    }
    if (wrote === 0) {
      const sentinel = await upsertLostLeadSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        leadId: LOST_LEAD_SOFT_SEED_SENTINEL_LEAD_ID,
        lostDate: LOST_LEAD_SOFT_SEED_SENTINEL_LOST_DATE,
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

  if (needsFullSeed) {
    for (const rule of rulesWithTemplate) {
      await seedRuleRows(rule, "seeded");
    }
    const { error: flagErr } = await input.admin
      .from("businesses")
      .update({ arbox_lost_lead_seeded: true })
      .eq("id", businessId);
    if (flagErr) {
      console.error("[leads/arbox-lost-lead] seed flag update failed:", flagErr.message);
      summary.errors += 1;
      summary.fetch_error = "arbox_lost_lead_seeded_flag_failed";
    }
    console.info("[leads/arbox-lost-lead] seeded 30-day window", {
      businessId,
      businessSlug,
      seeded: summary.seeded,
    });
    return summary;
  }

  const seededThisRun = new Set<string>();
  for (const rule of rulesWithTemplate) {
    const { count, error } = await input.admin
      .from("arbox_lost_lead_sync_log")
      .select("lead_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("trigger_id", rule.id);
    if (error) {
      console.error("[leads/arbox-lost-lead] per-trigger seed count failed:", error.message);
      continue;
    }
    if ((count ?? 0) > 0) continue;
    await seedRuleRows(rule, "soft_seeded");
    seededThisRun.add(rule.id);
  }

  for (const raw of reportRows) {
    const row = raw as ArboxLostLeadRow;
    const leadId = parseLostLeadId(row);
    const lostDate = normalizeLostDatePk(row.lost_date);
    if (leadId == null || !lostDate) {
      summary.errors += 1;
      continue;
    }
    if (leadId === LOST_LEAD_SOFT_SEED_SENTINEL_LEAD_ID) continue;

    const eventYmd = reportTimestampToYmd(lostDate);
    let resolved: Awaited<ReturnType<typeof resolveOrCreateContact>> | undefined;

    for (const rule of rulesWithTemplate) {
      if (seededThisRun.has(rule.id)) continue;
      if (
        !eventYmd ||
        !isExactDaysAfterEvent({
          eventYmd,
          todayYmd,
          delayDays: rule.delay_days,
        })
      ) {
        continue;
      }

      summary.processed += 1;
      const logBase = {
        businessId,
        trigger_id: rule.id,
        lead_id: leadId,
        lost_date: lostDate,
      };

      try {
        const { data: existing } = await input.admin
          .from("arbox_lost_lead_sync_log")
          .select("status, attempts, contact_id")
          .eq("business_id", businessId)
          .eq("trigger_id", rule.id)
          .eq("lead_id", leadId)
          .eq("lost_date", lostDate)
          .maybeSingle();

        const existingStatus = String((existing as { status?: unknown } | null)?.status ?? "").trim();
        const existingAttempts = parseCancellationSyncAttempts(
          (existing as { attempts?: unknown } | null)?.attempts
        );
        if (existingStatus && existingStatus !== "pending") {
          summary.already += 1;
          console.info("[leads/arbox-lost-lead] dispatch", {
            ...logBase,
            dispatch: "already" satisfies LostLeadDispatch,
          });
          continue;
        }

        if (!resolved) {
          resolved = await resolveOrCreateContact({
            admin: input.admin,
            businessId,
            row,
            leadId,
          });
        }
        const phone = resolved.phone;
        if (!phone) {
          summary.no_phone += 1;
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "no_phone",
            attempts: existingAttempts,
          });
          if (!marked.ok) summary.errors += 1;
          console.info("[leads/arbox-lost-lead] dispatch", {
            ...logBase,
            contact: resolved.contact?.id ?? null,
            dispatch: "no_phone" satisfies LostLeadDispatch,
          });
          continue;
        }

        const send = await dispatchLostLeadTemplate({
          admin: input.admin,
          businessId,
          businessSlug,
          phone,
          fullName: resolveReportFullName(row) ?? resolved.contact?.full_name ?? null,
          leadId,
          lostDate,
          rule,
        });

        if (send.dispatch === "immediate") summary.notified += 1;
        else if (send.dispatch === "deferred") summary.deferred += 1;
        else if (send.dispatch === "gated") summary.gated += 1;

        console.info("[leads/arbox-lost-lead] dispatch", {
          ...logBase,
          contact: resolved.contact?.id ?? null,
          phone: maskPhoneForLog(phone),
          dispatch: send.dispatch,
        });

        if (
          send.dispatch === "immediate" ||
          send.dispatch === "deferred" ||
          send.dispatch === "gated" ||
          send.dispatch === "send_failed"
        ) {
          const next = nextCancellationSyncLogAfterDispatch({
            dispatch: send.dispatch,
            attemptsSoFar: existingAttempts,
          });
          if (next.hitCap) summary.abandoned += 1;
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: next.status,
            attempts: next.attempts,
          });
          if (!marked.ok) summary.errors += 1;
        }
      } catch (e) {
        summary.errors += 1;
        console.error("[leads/arbox-lost-lead] row threw", {
          businessId,
          trigger_id: rule.id,
          lead_id: leadId,
          lost_date: lostDate,
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
