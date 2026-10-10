/**
 * Arbox class auto-booking after a paid trial sale. Per-business opt-in
 * (`businesses.arbox_class_autobook_enabled`, default false). Runs inside arbox-trial-sync.
 *
 * Before the sale handler: resolve the class the lead picked in Zoe's flow, check the
 * occurrence, claim the sale in `arbox_class_autobook_attempts`, book once, send the one
 * booking-result message (open 24h window only). After the handler: hand off to the team
 * when the booking did not happen. A sale is booked at most once — never retried.
 *
 * Missing column → flag off. Missing table → no booking (claim fails closed).
 */
import { fetchLastSfServiceEventName, logMessage } from "@/lib/analytics";
import { getOccurrenceRawData, resolveOccurrenceScheduleId, resolveOccurrenceState } from "@/lib/arbox-occurrence-state";
import { israelYmd, addDaysYmd, parseServiceDescriptionObject } from "@/lib/arbox-schedule-sync";
import { isSendsHoldError } from "@/lib/business-sends-hold";
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { handleLeadHumanRequested } from "@/lib/human-requested";
import {
  AUTOBOOK_NOT_BOOKED_TEXT,
  autobookBookedTextFromSocial,
  autobookOccurrenceKey,
  bookingIdFromBookSessionJson,
  fillAutobookBookedText,
  resolveAutobookTarget,
  summarizeArboxBookingError,
} from "@/lib/leads/arbox-class-autobook";
import { fetchAllSalesReportRows } from "@/lib/leads/arbox-sales-report";
import {
  arboxSaleHasOutstandingDebt,
  handleArboxTrialSaleRegistered,
  type ArboxSalesReportRow,
} from "@/lib/leads/arbox-trial-sale-registered";
import { thrownSendOutcome } from "@/lib/notifications/graph-whatsapp-send";
import { buildWaSessionId, canonicalContactPhone, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadTrialSignupNotice, trialPurchaseTemplateBlockedByZoe } from "@/lib/trial-signup-notice";
import { withWaMessageLogScope } from "@/lib/wa-message-log-context";
import "@/lib/wa-message-log-als.server";
import { evaluateSessionMessageSend } from "@/lib/wa-marketing-opt-out";
import {
  fetchLatestUserMessageAcrossChannels,
  loadActiveWaChannels,
  resolveSendChannelForContact,
} from "@/lib/wa-resolve-send-channel";
import { resolveTwilioAccountSid, resolveTwilioAuthToken, sendWhatsAppMessage } from "@/lib/whatsapp";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const LOG = "[arbox-class-autobook]";
const TABLE = "arbox_class_autobook_attempts";
const FLAG_COLUMN = "arbox_class_autobook_enabled";
const BOOK_TIMEOUT_MS = 8_000;
/** Contact + session + product reads, one GET pair (≤2s) and the POST (≤8s). */
const AUTOBOOK_STEP_MIN_MS = 12_000;
const WA_USER_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const PICK_ANCHOR_MODELS = ["sales_flow_after_schedule_selection", "sf_service_registration_cta_slot"];

/** salesReport row fields this step reads beyond the handler's type. */
type AutobookSaleRow = ArboxSalesReportRow & {
  membership_user_id?: unknown;
  start_date?: unknown;
  end_date?: unknown;
};

type AttemptState = {
  status: string;
  contact_id: string | null;
  handoff_pending: boolean;
};

export type ArboxClassAutobookSummary = {
  candidates: number;
  skipped: number;
  booked: number;
  rejected: number;
  unknown: number;
  handoff: number;
  errors: number;
  budget_skipped: number;
  would_book: { sale_id: number; date: string; time: string; class_name: string; schedule_id: number }[];
  would_handoff: { sale_id: number; reason: string }[];
};

export type ArboxClassAutobookBatch = {
  admin: Admin;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  trialIds: readonly number[];
  now: Date;
  dryRun: boolean;
  deadlineMs?: number;
  bookedText: string;
  attempts: Map<number, AttemptState>;
  summary: ArboxClassAutobookSummary;
};

type BatchBusiness = {
  id: number;
  slug: string;
  apiKey: string;
  crm_box_id: string;
  arbox_trial_membership_type_ids: readonly number[];
};

function emptySummary(): ArboxClassAutobookSummary {
  return {
    candidates: 0,
    skipped: 0,
    booked: 0,
    rejected: 0,
    unknown: 0,
    handoff: 0,
    errors: 0,
    budget_skipped: 0,
    would_book: [],
    would_handoff: [],
  };
}

function isMissingColumnOrTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204" || error.code === "42P01" || error.code === "PGRST205") {
    return true;
  }
  return /does not exist|could not find/i.test(String(error.message ?? ""));
}

function positiveInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Tolerant: a missing column (migration not run) reads as off. */
export async function loadArboxClassAutobookSettings(
  admin: Admin,
  businessId: number
): Promise<{ enabled: boolean; bookedText: string }> {
  const { data, error } = await admin
    .from("businesses")
    .select(`${FLAG_COLUMN}, social_links`)
    .eq("id", businessId)
    .maybeSingle();
  if (error) {
    if (!isMissingColumnOrTable(error)) {
      console.error(LOG, "flag read failed", { business_id: businessId, error: error.message });
    }
    return { enabled: false, bookedText: "" };
  }
  const row = data as { arbox_class_autobook_enabled?: unknown; social_links?: unknown } | null;
  return {
    enabled: row?.arbox_class_autobook_enabled === true,
    bookedText: autobookBookedTextFromSocial(row?.social_links),
  };
}

/**
 * Registration-CTA path: the lead named a concrete class and got the payment link. Same
 * fields the slot-pick path writes; the `sf_service_registration_cta_slot` event already
 * logged by the CTA is the pick anchor. Flag-off businesses: one read, no write.
 */
export async function persistArboxClassAutobookCtaPick(input: {
  admin: Admin;
  businessId: number;
  phone: string;
  dayName: string;
  time: string;
}): Promise<void> {
  try {
    const { enabled } = await loadArboxClassAutobookSettings(input.admin, input.businessId);
    if (!enabled) return;
    const variants = contactPhoneLookupVariants(input.phone);
    const { error } = await input.admin
      .from("contacts")
      .update({ sf_requested_date: input.dayName, sf_requested_time: input.time })
      .eq("business_id", input.businessId)
      .in("phone", variants.length ? variants : [input.phone]);
    if (error) console.error(LOG, "CTA pick persist failed", { business_id: input.businessId, error: error.message });
  } catch (e) {
    console.error(LOG, "CTA pick persist threw", { business_id: input.businessId, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Paid, configured trial product, with the membership Arbox books against. */
export function isAutobookCandidateRow(row: AutobookSaleRow, trialIds: readonly number[]): boolean {
  if (positiveInt(row.sale_id) == null || positiveInt(row.user_id) == null) return false;
  if (arboxSaleHasOutstandingDebt(row)) return false;
  const typeId = positiveInt(row.membership_type_id);
  if (typeId == null || !trialIds.includes(typeId)) return false;
  return positiveInt(row.membership_user_id) != null;
}

/**
 * Null (and zero reads) unless the batch has a candidate row. Then one flag read and
 * one attempts read for the whole batch.
 */
export async function prepareArboxClassAutobookBatch(input: {
  admin: Admin;
  business: BatchBusiness;
  rows: readonly unknown[];
  now: Date;
  dryRun: boolean;
  deadlineMs?: number;
}): Promise<ArboxClassAutobookBatch | null> {
  const trialIds = input.business.arbox_trial_membership_type_ids ?? [];
  if (!trialIds.length) return null;
  const saleIds = input.rows
    .filter((row) => isAutobookCandidateRow(row as AutobookSaleRow, trialIds))
    .map((row) => Number((row as AutobookSaleRow).sale_id));
  if (!saleIds.length) return null;

  const settings = await loadArboxClassAutobookSettings(input.admin, input.business.id);
  if (!settings.enabled) return null;

  const { data, error } = await input.admin
    .from(TABLE)
    .select("sale_id, status, contact_id, handoff_pending")
    .eq("business_id", input.business.id)
    .in("sale_id", [...new Set(saleIds)]);
  if (error) {
    console.error(LOG, "attempts prefetch failed — no booking this tick", {
      slug: input.business.slug,
      error: error.message,
    });
    return null;
  }
  const attempts = new Map<number, AttemptState>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    attempts.set(Number(row.sale_id), {
      status: String(row.status ?? ""),
      contact_id: row.contact_id ? String(row.contact_id) : null,
      handoff_pending: row.handoff_pending === true,
    });
  }

  // Sales the handler already took (before the flag was turned on) are never booked late.
  const unclaimed = [...new Set(saleIds)].filter((id) => !attempts.has(id));
  const { data: seen, error: seenErr } = unclaimed.length
    ? await input.admin
        .from("arbox_trial_sync_log")
        .select("sale_id")
        .eq("business_id", input.business.id)
        .in("sale_id", unclaimed)
    : { data: [], error: null };
  if (seenErr) {
    console.error(LOG, "seen prefetch failed — no booking this tick", {
      slug: input.business.slug,
      error: seenErr.message,
    });
    return null;
  }
  for (const row of (seen ?? []) as Array<{ sale_id?: unknown }>) {
    const id = Number(row.sale_id);
    if (!attempts.has(id)) attempts.set(id, { status: "handled_before", contact_id: null, handoff_pending: false });
  }

  return {
    admin: input.admin,
    businessId: input.business.id,
    businessSlug: input.business.slug,
    apiKey: input.business.apiKey,
    boxId: String(input.business.crm_box_id ?? "").trim(),
    trialIds,
    now: input.now,
    dryRun: input.dryRun,
    deadlineMs: input.deadlineMs,
    bookedText: settings.bookedText,
    attempts,
    summary: emptySummary(),
  };
}

type ContactRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  sf_requested_date: string | null;
  sf_requested_time: string | null;
};

const CONTACT_SELECT = "id, phone, full_name, sf_requested_date, sf_requested_time";

async function findContact(batch: ArboxClassAutobookBatch, row: AutobookSaleRow): Promise<ContactRow | null> {
  const arboxUserId = String(row.user_id ?? "").trim();
  const { data: byArbox } = await batch.admin
    .from("contacts")
    .select(CONTACT_SELECT)
    .eq("business_id", batch.businessId)
    .eq("arbox_user_id", arboxUserId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (byArbox?.[0]) return byArbox[0] as ContactRow;
  const phoneNorm = canonicalContactPhone(row.phone);
  if (!phoneNorm) return null;
  const variants = [...new Set([...contactPhoneLookupVariants(row.phone), ...contactPhoneLookupVariants(phoneNorm)])];
  const { data: byPhone } = await batch.admin
    .from("contacts")
    .select(CONTACT_SELECT)
    .eq("business_id", batch.businessId)
    .in("phone", variants.length ? variants : [phoneNorm])
    .order("updated_at", { ascending: false })
    .limit(1);
  return (byPhone?.[0] as ContactRow | undefined) ?? null;
}

async function sessionIdForPhone(batch: ArboxClassAutobookBatch, phone: string): Promise<string> {
  const channel = await resolveSendChannelForContact(batch.admin, batch.businessId, phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  return phoneNumberId ? buildWaSessionId(phoneNumberId, phone) : "";
}

async function loadPickAnchorAt(batch: ArboxClassAutobookBatch, sessionId: string): Promise<string | null> {
  const { data } = await batch.admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", batch.businessSlug)
    .eq("session_id", sessionId)
    .in("model_used", PICK_ANCHOR_MODELS)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0] as { created_at?: string } | undefined)?.created_at ?? null;
}

/** Exactly one product with this name, else null. */
async function loadProductMeta(
  batch: ArboxClassAutobookBatch,
  serviceName: string
): Promise<{ meta: Record<string, unknown> } | null> {
  const { data } = await batch.admin
    .from("services")
    .select("description")
    .eq("business_id", batch.businessId)
    .eq("name", serviceName)
    .limit(2);
  if (!data || data.length !== 1) return null;
  return { meta: parseServiceDescriptionObject(String((data[0] as { description?: unknown }).description ?? "")) };
}

async function insertAttempt(batch: ArboxClassAutobookBatch, row: Record<string, unknown>): Promise<"ok" | "conflict" | "error"> {
  const { error } = await batch.admin.from(TABLE).insert({ business_id: batch.businessId, ...row });
  if (!error) return "ok";
  if (error.code === "23505") return "conflict";
  console.error(LOG, "attempt insert failed", { slug: batch.businessSlug, error: error.message });
  return "error";
}

async function updateAttempt(batch: ArboxClassAutobookBatch, saleId: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await batch.admin.from(TABLE).update(patch).eq("business_id", batch.businessId).eq("sale_id", saleId);
  if (error) console.error(LOG, "attempt update failed", { slug: batch.businessSlug, sale_id: saleId, error: error.message });
}

type TextOutcome =
  | "sent"
  | "already_notified"
  | "opted_out"
  | "no_channel"
  | "no_user_session"
  | "outside_24h_window"
  | "notice_claim_lost"
  | "sends_hold"
  | "send_failed"
  | "send_unknown";

/**
 * The one booking-result message. Claims `trial_signup_notice = 'zoe'` first, so the sale
 * handler and the booking-detection step both stay silent for this lead.
 */
async function sendAutobookText(
  batch: ArboxClassAutobookBatch,
  phone: string,
  text: string,
  modelUsed: string,
  saleId: number,
  /** Booked: a failed send hands the confirmation back to the handler's default text. */
  releaseOnFailure: boolean
): Promise<TextOutcome> {
  const { admin, businessId, businessSlug } = batch;
  const notice = await loadTrialSignupNotice(admin, businessId, phone);
  if (trialPurchaseTemplateBlockedByZoe(notice)) return "already_notified";
  if ((await evaluateSessionMessageSend({ admin, businessId, phone })).suppress) return "opted_out";

  const channels = await loadActiveWaChannels(admin, businessId);
  const phoneNumberIds = [...new Set(channels.map((c) => c.phoneNumberId).filter(Boolean))];
  if (!phoneNumberIds.length) return "no_channel";
  const latestUser = await fetchLatestUserMessageAcrossChannels({ admin, businessSlug, phone, phoneNumberIds });
  if (!latestUser) return "no_user_session";
  const lastUserMs = Date.parse(latestUser.createdAt ?? "");
  if (!Number.isFinite(lastUserMs) || Date.now() - lastUserMs >= WA_USER_SESSION_WINDOW_MS) {
    console.info(LOG, "24h window closed — no free text; trial purchase templates as today", {
      slug: businessSlug,
      sale_id: saleId,
    });
    return "outside_24h_window";
  }

  const variants = contactPhoneLookupVariants(phone);
  const { data: claimed, error: claimErr } = await admin
    .from("contacts")
    .update({ trial_signup_notice: "zoe" })
    .eq("business_id", businessId)
    .in("phone", variants.length ? variants : [phone])
    .is("trial_signup_notice", null)
    .select("id");
  if (claimErr || !claimed?.length) return "notice_claim_lost";

  const releaseNotice = async () => {
    if (!releaseOnFailure) return;
    await admin
      .from("contacts")
      .update({ trial_signup_notice: null })
      .eq("business_id", businessId)
      .in("phone", variants.length ? variants : [phone])
      .eq("trial_signup_notice", "zoe");
  };

  const phoneNumberId = latestUser.phoneNumberId;
  const sessionId = buildWaSessionId(phoneNumberId, phone) || latestUser.sessionId;
  return await withWaMessageLogScope({ businessSlug, sessionId }, async () => {
    try {
      await sendWhatsAppMessage(phoneNumberId, phone, text, resolveTwilioAccountSid(), resolveTwilioAuthToken());
      await logMessage({ business_slug: businessSlug, role: "assistant", content: text, model_used: modelUsed, session_id: sessionId });
      return "sent" as const;
    } catch (e) {
      if (isSendsHoldError(e)) {
        await releaseNotice();
        return "sends_hold" as const;
      }
      const unknown = thrownSendOutcome(e) === "unknown";
      console.error(LOG, "result message send failed", {
        slug: businessSlug,
        sale_id: saleId,
        outcome: unknown ? "unknown" : "failed",
        error: e instanceof Error ? e.message : String(e),
      });
      if (!unknown) await releaseNotice();
      return unknown ? ("send_unknown" as const) : ("send_failed" as const);
    }
  });
}

/**
 * Runs before handleArboxTrialSaleRegistered for the same row. True when this sale is an
 * auto-book lead (booked, or booking refused → handoff). False leaves the sale exactly as today.
 * Never throws.
 */
export async function runArboxClassAutobookBeforeSale(
  batch: ArboxClassAutobookBatch,
  rawRow: unknown
): Promise<boolean> {
  const row = rawRow as AutobookSaleRow;
  if (!isAutobookCandidateRow(row, batch.trialIds)) return false;
  const saleId = Number(row.sale_id);
  if (batch.attempts.has(saleId)) return false;
  if (batch.deadlineMs != null && batch.deadlineMs - Date.now() < AUTOBOOK_STEP_MIN_MS) {
    batch.summary.budget_skipped += 1;
    console.warn(LOG, "postponed (time budget)", { slug: batch.businessSlug, sale_id: saleId });
    return false;
  }

  try {
    const arboxUserId = String(row.user_id ?? "").trim();
    const contact = await findContact(batch, row);
    const phone = canonicalContactPhone(contact?.phone ?? "");
    const sessionId = contact && phone ? await sessionIdForPhone(batch, phone) : "";

    const skip = async (reason: string): Promise<false> => {
      batch.summary.skipped += 1;
      console.info(LOG, "skipped — sale handled as today", { slug: batch.businessSlug, sale_id: saleId, reason });
      if (!batch.dryRun) {
        await insertAttempt(batch, {
          sale_id: saleId,
          contact_id: contact?.id ?? null,
          arbox_user_id: arboxUserId,
          status: "skipped",
          reason,
          settled_at: batch.now.toISOString(),
        });
      }
      batch.attempts.set(saleId, { status: "skipped", contact_id: contact?.id ?? null, handoff_pending: false });
      return false;
    };

    if (!contact || !phone) return await skip("no_contact");
    if (!sessionId) return await skip("no_session");

    const [serviceName, pickAt] = await Promise.all([
      fetchLastSfServiceEventName({ business_slug: batch.businessSlug, session_id: sessionId }),
      loadPickAnchorAt(batch, sessionId),
    ]);
    const product = serviceName ? await loadProductMeta(batch, serviceName) : null;
    const target = resolveAutobookTarget({
      pick: { date: contact.sf_requested_date, time: contact.sf_requested_time },
      pickAt,
      now: batch.now,
      product,
      saleRow: row,
    });
    if (target.kind === "skip") return await skip(target.reason);

    batch.summary.candidates += 1;
    const base = {
      sale_id: saleId,
      contact_id: contact.id,
      arbox_user_id: arboxUserId,
      occurrence_date: target.date,
      occurrence_time: target.time,
      class_name: target.className,
      membership_user_id: positiveInt(row.membership_user_id),
    };

    let handoffReason = target.kind === "handoff" ? target.reason : "";
    let scheduleId: number | null = null;
    if (target.kind === "target") {
      const raw = await getOccurrenceRawData({
        businessId: batch.businessId,
        apiKey: batch.apiKey,
        boxId: batch.boxId,
        date: target.date,
        skipCache: true,
      });
      const state = resolveOccurrenceState(raw, target.date, target.time, target.className).state;
      scheduleId = state === "open" ? resolveOccurrenceScheduleId(raw, target.date, target.time, target.className) : null;
      if (state !== "open") handoffReason = `occurrence_${state}`;
      else if (scheduleId == null) handoffReason = "schedule_id_ambiguous";
    }

    if (batch.dryRun) {
      if (handoffReason) batch.summary.would_handoff.push({ sale_id: saleId, reason: handoffReason });
      else {
        batch.summary.would_book.push({
          sale_id: saleId,
          date: target.date,
          time: target.time,
          class_name: target.className,
          schedule_id: scheduleId!,
        });
      }
      console.info(LOG, "dry run", { slug: batch.businessSlug, sale_id: saleId, would: handoffReason ? "handoff" : "book", reason: handoffReason || undefined });
      return false;
    }

    let status: "booked" | "rejected" | "unknown" | "handoff";
    if (handoffReason) {
      const claim = await insertAttempt(batch, { ...base, status: "handoff", reason: handoffReason, handoff_pending: true });
      if (claim !== "ok") return false;
      status = "handoff";
    } else {
      const claim = await insertAttempt(batch, { ...base, schedule_id: scheduleId, status: "claimed" });
      if (claim !== "ok") return false;

      let res: Awaited<ReturnType<typeof arboxPublicFetch>>;
      try {
        res = await arboxPublicFetch("/v3/schedule/bookSession", {
          apiKey: batch.apiKey,
          method: "POST",
          body: { user_id: Number(arboxUserId), schedule_id: scheduleId, membership_user_id: base.membership_user_id },
          timeoutMs: BOOK_TIMEOUT_MS,
        });
      } catch (e) {
        console.error(LOG, "bookSession network error", { slug: batch.businessSlug, sale_id: saleId, error: e instanceof Error ? e.name : "error" });
        res = { ok: false, status: 0, json: null, rawText: "network" };
      }

      if (res.ok) {
        status = "booked";
        await updateAttempt(batch, saleId, {
          status,
          http_status: res.status,
          booking_id: bookingIdFromBookSessionJson(res.json),
          settled_at: new Date().toISOString(),
        });
      } else {
        status = res.status === 0 ? "unknown" : "rejected";
        handoffReason = res.status === 0 ? `book_${res.rawText || "timeout"}` : "book_rejected";
        await updateAttempt(batch, saleId, {
          status,
          reason: handoffReason,
          http_status: res.status,
          error_summary: summarizeArboxBookingError(res.json),
          handoff_pending: true,
        });
      }
      console.info(LOG, "bookSession", { slug: batch.businessSlug, sale_id: saleId, status, http_status: res.status });
    }
    batch.summary[status] += 1;
    batch.attempts.set(saleId, { status, contact_id: contact.id, handoff_pending: status !== "booked" });

    let messageOutcome = "handler_default";
    if (status !== "booked") {
      messageOutcome = await sendAutobookText(
        batch,
        phone,
        AUTOBOOK_NOT_BOOKED_TEXT,
        "arbox_class_autobook_not_booked",
        saleId,
        false
      );
    } else if (batch.bookedText) {
      messageOutcome = await sendAutobookText(
        batch,
        phone,
        fillAutobookBookedText(batch.bookedText, target),
        "arbox_class_autobook_booked",
        saleId,
        true
      );
    }
    await updateAttempt(batch, saleId, { message_outcome: messageOutcome });
    return true;
  } catch (e) {
    batch.summary.errors += 1;
    console.error(LOG, "step threw", { slug: batch.businessSlug, sale_id: saleId, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/**
 * Runs after the sale handler (which clears human_requested_at), so the handoff sticks.
 * Retries on later ticks while the sale is still in the report; never retries the booking.
 */
export async function runArboxClassAutobookAfterSale(
  batch: ArboxClassAutobookBatch,
  rawRow: unknown,
  handlerOk: boolean
): Promise<void> {
  const saleId = Number((rawRow as AutobookSaleRow).sale_id);
  const attempt = batch.attempts.get(saleId);
  if (!attempt?.handoff_pending || !attempt.contact_id || !handlerOk || batch.dryRun) return;
  try {
    const { data } = await batch.admin
      .from("contacts")
      .select("phone, full_name")
      .eq("id", attempt.contact_id)
      .maybeSingle();
    const contact = data as { phone?: string | null; full_name?: string | null } | null;
    const phone = canonicalContactPhone(contact?.phone ?? "");
    if (!phone) return;
    const sessionId = await sessionIdForPhone(batch, phone);
    if (!sessionId) return;

    const res = await handleLeadHumanRequested({
      supabase: batch.admin,
      businessId: batch.businessId,
      businessSlug: batch.businessSlug,
      phone,
      nowIso: new Date().toISOString(),
      sessionId,
      fullName: contact?.full_name ?? null,
    });
    if (res.already) {
      const { data: after } = await batch.admin
        .from("contacts")
        .select("human_requested_at")
        .eq("id", attempt.contact_id)
        .maybeSingle();
      if (!(after as { human_requested_at?: string | null } | null)?.human_requested_at) {
        console.warn(LOG, "handoff not stamped — session paused by staff", { slug: batch.businessSlug, sale_id: saleId });
      }
    }
    attempt.handoff_pending = false;
    await updateAttempt(batch, saleId, { handoff_pending: false, settled_at: new Date().toISOString() });
  } catch (e) {
    batch.summary.errors += 1;
    console.error(LOG, "handoff threw", { slug: batch.businessSlug, sale_id: saleId, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Bookings Zoe made (or may have made, on timeout). The booking-detection step stays silent for them. */
export async function loadAutobookedOccurrenceKeys(
  admin: Admin,
  businessId: number,
  now: Date
): Promise<Set<string> | undefined> {
  const settings = await loadArboxClassAutobookSettings(admin, businessId);
  if (!settings.enabled) return undefined;
  const { data, error } = await admin
    .from(TABLE)
    .select("arbox_user_id, occurrence_date, occurrence_time")
    .eq("business_id", businessId)
    .in("status", ["booked", "unknown", "claimed"])
    .gte("occurrence_date", addDaysYmd(israelYmd(now), -1));
  if (error) {
    console.error(LOG, "autobooked keys read failed", { business_id: businessId, error: error.message });
    return undefined;
  }
  return new Set(
    ((data ?? []) as Array<Record<string, unknown>>).map((r) =>
      autobookOccurrenceKey(r.arbox_user_id, r.occurrence_date, r.occurrence_time)
    )
  );
}

/**
 * Night hold (21:00-08:00), flag-on businesses only: the trial sales that resolve to an
 * auto-book lead run now (booking, result message, handler, handoff). Every other sale and
 * every other step still waits for 08:00. The sync cursor does not move.
 */
export async function runArboxClassAutobookNightPass(input: {
  admin: Admin;
  business: BatchBusiness;
  fromDate: string;
  toDate: string;
  now: Date;
  dryRun: boolean;
  deadlineMs?: number;
}): Promise<ArboxClassAutobookSummary | null> {
  const trialIds = input.business.arbox_trial_membership_type_ids ?? [];
  if (!trialIds.length) return null;
  const settings = await loadArboxClassAutobookSettings(input.admin, input.business.id);
  if (!settings.enabled) return null;

  const report = await fetchAllSalesReportRows({
    apiKey: input.business.apiKey,
    fromDate: input.fromDate,
    toDate: input.toDate,
    locationId: input.business.crm_box_id,
  });
  if (!report.ok) {
    console.error(LOG, "night pass sales fetch failed", { slug: input.business.slug, error: report.error });
    return null;
  }
  const batch = await prepareArboxClassAutobookBatch({
    admin: input.admin,
    business: input.business,
    rows: report.rows,
    now: input.now,
    dryRun: input.dryRun,
    deadlineMs: input.deadlineMs,
  });
  if (!batch) return null;

  for (const row of report.rows) {
    if (!(await runArboxClassAutobookBeforeSale(batch, row))) continue;
    let handlerOk = false;
    try {
      const result = await handleArboxTrialSaleRegistered({
        admin: input.admin,
        businessId: input.business.id,
        businessSlug: input.business.slug,
        row: row as ArboxSalesReportRow,
        trialMembershipTypeIds: trialIds,
      });
      handlerOk = result.ok;
      if (!result.ok) console.error(LOG, "night handler failed", { slug: input.business.slug, error: result.error });
    } catch (e) {
      console.error(LOG, "night handler threw", { slug: input.business.slug, error: e instanceof Error ? e.message : String(e) });
    }
    await runArboxClassAutobookAfterSale(batch, row, handlerOk);
  }
  return batch.summary;
}
