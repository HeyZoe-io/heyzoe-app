import { NextRequest, NextResponse } from "next/server";
import { acknowledgeCron, cronDryRunNow, rejectCronTimeOverride } from "@/lib/cron-clock";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage, sessionHasSalesFlowGreeting } from "@/lib/analytics";
import { parseModelUsed } from "@/lib/wa-reply-route";
import { withWaMessageLogScope } from "@/lib/wa-message-log-context";
import "@/lib/wa-message-log-als.server";
import { isBusinessSubscriptionActive } from "@/lib/notifications/business-notification-eligibility";
import {
  sendWhatsAppIdleFollowupMessage,
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
  resolveMetaAppSecret,
} from "@/lib/whatsapp";
import { drainInboundReplayRequests, signMetaPayload } from "@/lib/wa-inbound-replay";
import { resolveCronSecret } from "@/lib/server-env";
import { nextAllowedWhatsAppSendTimeIsrael, WA_FOLLOWUP_QUIET_END_MINUTES } from "@/lib/israel-time";
import {
  resolveWaSalesFollowupTemplates,
  resolveWaSalesFollowupEnabled,
  resolveWaFollowupSendPlan,
  isWaSalesFollowupStageEnabled,
  stripPhonePlaceholderClauseWhenEmpty,
  WA_FOLLOWUP_MS_20_MIN,
  WA_FOLLOWUP_MS_2_H,
  WA_FOLLOWUP_MS_23_H,
} from "@/lib/wa-sales-followup-defaults";
import { evaluateBusinessWaFollowup } from "@/lib/wa-followup-cron-eval";
import { hasTrialSignupNotice } from "@/lib/trial-signup-notice";
import { resolveWaFollowupCta } from "@/lib/wa-followup-cta";
import { customerServicePhoneFromSocialLinks } from "@/lib/whatsapp-copy";
import { contactPhoneLookupVariants, buildWaSessionId, waSessionIdLookupVariants } from "@/lib/phone-normalize";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";
import {
  claimFollowupSeriesStart,
  releaseFollowupSeriesClaim,
  decideFollowupSeriesGate,
  FOLLOWUP_SERIES_LOCK_COLUMN,
  FOLLOWUP_SERIES_OPEN_OR_IN_PROGRESS,
  followupSeriesLockColumnExists,
} from "@/lib/followup-series-lock";
import {
  decideFollowupStep,
  isOutsideLeadWindow,
  maskFollowupPhone,
  recordFollowupCancellation,
  type FollowupCancellation,
} from "@/lib/followup-hold-policy";

/**
 * נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET כל ~5 דק׳ + Authorization: Bearer CRON_SECRET
 * `dry_run=1` (אופציונלי `now=ISO`): בלי שליחה, בלי עדכונים, בלי נעילה, בלי replay. מחזיר would_send / would_cancel.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 200;
const FOLLOWUP_FOOTER = "\n\n_לביטול קבלת הודעות שלח *הסר*_";

type WaFollowupSkipReason =
  | "time_window"
  | "invalid_contact"
  | "no_active_channel"
  | "no_assistant_message"
  | "no_user_message"
  | "no_response"
  | "over_24h"
  | "already_replied"
  | "not_due_yet"
  | "send_failed"
  | "session_paused"
  | "stage_disabled"
  | "node_followups"
  | "sales_flow_not_started"
  | "series_locked"
  | "delayed_step_cancelled"
  | "outside_24h_window";

const WA_FOLLOWUP_STEP_OFFSET_MS = [0, WA_FOLLOWUP_MS_20_MIN, WA_FOLLOWUP_MS_2_H, WA_FOLLOWUP_MS_23_H] as const;

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/wa-followups] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function logWaFollowupSkip(
  reason: WaFollowupSkipReason,
  meta: Record<string, unknown>
): void {
  console.info("[cron/wa-followups] skip", { skip_reason: reason, ...meta });
}

function maskPhone(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

const CONTACT_DEBUG_SELECT =
  "id, phone, full_name, wa_no_response_at, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, last_contact_at, opted_out, marketing_opted_out, trial_registered, self_reported_registered_at, trial_signup_notice";
const CONTACT_DEBUG_SELECT_NO_MARKETING =
  "id, phone, full_name, wa_no_response_at, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, last_contact_at, opted_out, trial_registered, self_reported_registered_at, trial_signup_notice";

async function findContactByPhone(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: string | number,
  phoneInput: string
): Promise<{ row: Record<string, unknown> | null; lookup_variants: string[] }> {
  const lookup_variants = contactPhoneLookupVariants(phoneInput);
  if (!lookup_variants.length) return { row: null, lookup_variants };

  const selected = await admin
    .from("contacts")
    .select(CONTACT_DEBUG_SELECT)
    .eq("business_id", businessId)
    .in("phone", lookup_variants)
    .limit(1);

  const resolved =
    selected.error && /marketing_opted_out/i.test(selected.error.message)
      ? await admin
          .from("contacts")
          .select(CONTACT_DEBUG_SELECT_NO_MARKETING)
          .eq("business_id", businessId)
          .in("phone", lookup_variants)
          .limit(1)
      : selected;

  if (selected.error && /marketing_opted_out/i.test(selected.error.message)) {
    console.error(
      "[cron/wa-followups] contacts.marketing_opted_out missing — run supabase/contacts_marketing_opted_out.sql"
    );
  }

  if (resolved.error) throw resolved.error;
  const row = (resolved.data?.[0] as Record<string, unknown> | undefined) ?? null;
  return { row, lookup_variants };
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

function notDueYetDetail(stageCurrent: number, elapsedMs: number): Record<string, unknown> {
  if (stageCurrent >= 3) return { wa_followup_stage: stageCurrent, detail: "all_stages_sent" };
  if (stageCurrent < 1) {
    return {
      wa_followup_stage: stageCurrent,
      detail: "waiting_20m",
      elapsed_ms: elapsedMs,
      need_ms: Math.max(0, WA_FOLLOWUP_MS_20_MIN - elapsedMs),
    };
  }
  if (stageCurrent < 2) {
    return {
      wa_followup_stage: stageCurrent,
      detail: "waiting_2h",
      elapsed_ms: elapsedMs,
      need_ms: Math.max(0, WA_FOLLOWUP_MS_2_H - elapsedMs),
    };
  }
  return {
    wa_followup_stage: stageCurrent,
    detail: "waiting_23h",
    elapsed_ms: elapsedMs,
    need_ms: Math.max(0, WA_FOLLOWUP_MS_23_H - elapsedMs),
  };
}

/** Last assistant turn that is not our own WA follow-up (those must not reset the silence clock). */
async function fetchLatestRealAssistantMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<{ created_at: string; model_used: string | null } | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data } = await input.admin
    .from("messages")
    .select("created_at, model_used")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(40);
  for (const row of data ?? []) {
    const raw = String((row as { model_used?: string | null }).model_used ?? "");
    const m = parseModelUsed(raw).model;
    if (!m.startsWith("wa_followup_") && m !== "wa_business_app" && row.created_at) {
      return { created_at: String(row.created_at), model_used: raw || null };
    }
  }
  return null;
}

/** ליד שהתחיל את מסלול התיבות. שורה אחת לפי (business_id, phone), באינדקס הייחודי. */
async function hasConversationBoxSession(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
}): Promise<boolean> {
  const digits = input.phone.replace(/\D/g, "");
  const variants = [...new Set([digits, ...contactPhoneLookupVariants(input.phone).map((p) => p.replace(/\D/g, ""))])].filter(
    Boolean
  );
  if (!input.businessId || !variants.length) return false;
  const { data, error } = await input.admin
    .from("business_conversation_sessions")
    .select("id")
    .eq("business_id", input.businessId)
    .in("phone", variants)
    .not("current_node_id", "is", null)
    .limit(1);
  if (error) {
    console.error("[cron/wa-followups] conversation box session lookup failed:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

async function hasUserReplyAfter(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
  afterIso: string;
}): Promise<boolean> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return false;
  const { data } = await input.admin
    .from("messages")
    .select("id, created_at")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "user")
    .gt("created_at", input.afterIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

async function fetchLatestUserMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<string | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data } = await input.admin
    .from("messages")
    .select("created_at, role")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = data?.created_at ? String(data.created_at) : "";
  return at || null;
}

/** Queued one-time replays of an unanswered inbound — see lib/wa-inbound-replay.ts. */
async function drainInboundReplays(req: NextRequest) {
  try {
    const appSecret = resolveMetaAppSecret();
    if (!appSecret) {
      console.error("[cron/wa-followups] inbound replay skipped — Meta app secret missing");
      return null;
    }
    const { POST: webhookPost } = await import("@/app/api/whatsapp/webhook/route");
    const webhookUrl = new URL("/api/whatsapp/webhook", req.nextUrl.origin).toString();
    return await drainInboundReplayRequests({
      admin: createSupabaseAdminClient(),
      dispatch: async (body) => {
        const res = await webhookPost(
          new NextRequest(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json", "x-hub-signature-256": signMetaPayload(appSecret, body) },
            body,
          })
        );
        return res.status;
      },
    });
  } catch (e) {
    console.error("[cron/wa-followups] inbound replay drain failed:", e);
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rejectedClock = rejectCronTimeOverride(req, true);
  if (rejectedClock) return rejectedClock;
  await acknowledgeCron(req, "/api/cron/wa-followups");
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";


  const accountSid = resolveTwilioAccountSid();
  const authToken = resolveTwilioAuthToken();
  const admin = createSupabaseAdminClient();

  const debugPhone = req.nextUrl.searchParams.get("debug_phone")?.trim() ?? "";
  const debugSlug = req.nextUrl.searchParams.get("debug_slug")?.trim().toLowerCase() ?? "";
  if (debugPhone && debugSlug) {
    const { data: biz } = await admin.from("businesses").select("id").eq("slug", debugSlug).maybeSingle();
    if (!biz?.id) {
      return NextResponse.json({ ok: false, error: "business_not_found", debug_slug: debugSlug }, { status: 404 });
    }
    let contact: Record<string, unknown> | null = null;
    let phoneLookupVariants: string[] = [];
    try {
      const found = await findContactByPhone(admin, biz.id, debugPhone);
      contact = found.row;
      phoneLookupVariants = found.lookup_variants;
    } catch (contactErr) {
      const message = contactErr instanceof Error ? contactErr.message : String(contactErr);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
    if (!contact) {
      const { data: bizForDebug } = await admin
        .from("businesses")
        .select("id")
        .ilike("slug", debugSlug)
        .limit(1)
        .maybeSingle();
      const debugBusinessId = Number((bizForDebug as { id?: unknown } | null)?.id);
      const resolvedDebug =
        Number.isFinite(debugBusinessId) && debugBusinessId > 0
          ? await resolveSendChannelForContact(admin, debugBusinessId, debugPhone)
          : null;
      const sessionPhoneKey = buildWaSessionId(resolvedDebug?.phoneNumberId ?? "", debugPhone);
      const sessionIds = resolvedDebug?.phoneNumberId
        ? waSessionIdLookupVariants(resolvedDebug.phoneNumberId, debugPhone)
        : [];
      const sessionId = sessionPhoneKey || null;
      let messages_hint: Record<string, unknown> | null = null;
      if (sessionIds.length) {
        const slugForMsgs = String(resolvedDebug?.businessSlug || debugSlug).trim().toLowerCase();
        const { data: lastUser } = await admin
          .from("messages")
          .select("created_at")
          .eq("business_slug", slugForMsgs)
          .in("session_id", sessionIds)
          .eq("role", "user")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: lastAssist } = await admin
          .from("messages")
          .select("created_at, model_used")
          .eq("business_slug", slugForMsgs)
          .in("session_id", sessionIds)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(5);
        const realAssist = (lastAssist ?? []).find((r) => {
          const m = parseModelUsed((r as { model_used?: string }).model_used).model;
          return !m.startsWith("wa_followup_") && m !== "wa_business_app";
        });
        messages_hint = {
          session_id: sessionId,
          session_id_variants: sessionIds,
          last_user_at: lastUser?.created_at ?? null,
          last_assistant_at: realAssist?.created_at ?? null,
        };
      }
      console.info("[cron/wa-followups] skip", {
        skip_reason: "no_contact_row",
        phone: maskPhone(debugPhone),
        business_slug: debugSlug,
        messages_hint,
      });
      return NextResponse.json({
        ok: true,
        debug: true,
        skip_reason: "no_contact_row",
        phone: maskPhone(debugPhone),
        business_slug: debugSlug,
        phone_lookup_variants: phoneLookupVariants,
        note: "contact missing in contacts table — cron batch only includes existing rows",
        messages_hint,
      });
    }
    if (contact.id != null && (await followupSeriesLockColumnExists(admin))) {
      const { data: lockRow } = await admin
        .from("contacts")
        .select(FOLLOWUP_SERIES_LOCK_COLUMN)
        .eq("id", contact.id as string | number)
        .maybeSingle();
      const lockedAt = (lockRow as Record<string, unknown> | null)?.[FOLLOWUP_SERIES_LOCK_COLUMN];
      const gate = decideFollowupSeriesGate({
        lockColumn: true,
        lockedAt: typeof lockedAt === "string" ? lockedAt : null,
        stageCurrent: Number(contact.wa_followup_stage ?? 0) || 0,
      });
      if (gate === "locked") {
        return NextResponse.json({
          ok: true,
          debug: true,
          skip_reason: "series_locked",
          phone: maskPhone(debugPhone),
          business_slug: debugSlug,
          followup_series_locked_at: lockedAt,
        });
      }
    }
    const contactPhone = String(contact.phone ?? "").trim();
    const evalResult = await evaluateBusinessWaFollowup({
      admin,
      business_slug: debugSlug,
      phone: contactPhone,
      contact: contact as {
        id?: string | number;
        wa_followup_stage?: number | null;
        opted_out?: boolean | null;
        marketing_opted_out?: boolean | null;
        trial_registered?: boolean | null;
        self_reported_registered_at?: string | null;
        trial_signup_notice?: string | null;
      },
    });
    if (evalResult.skip_reason !== "eligible") {
      logWaFollowupSkip(evalResult.skip_reason as WaFollowupSkipReason, {
        phone: maskPhone(debugPhone),
        business_slug: debugSlug,
        contact_id: contact.id,
        ...evalResult.detail,
      });
    }
    const evalBody = Object.fromEntries(Object.entries(evalResult).filter(([key]) => key !== "business_slug"));
    return NextResponse.json({
      ok: true,
      debug: true,
      phone: maskPhone(contactPhone),
      phone_query: maskPhone(debugPhone),
      business_slug: debugSlug,
      contact_id: contact.id,
      trial_registered: contact.trial_registered ?? null,
      self_reported_registered_at: contact.self_reported_registered_at ?? null,
      opted_out: contact.opted_out ?? null,
      phone_lookup_variants: phoneLookupVariants,
      wa_followup_stage: contact.wa_followup_stage,
      last_contact_at: contact.last_contact_at,
      ...evalBody,
    });
  }

  const inboundReplays = dryRun ? null : await drainInboundReplays(req);

  const now = (dryRun ? cronDryRunNow(req) : undefined) ?? new Date();
  const nowMs = now.getTime();
  const allowedAt = nextAllowedWhatsAppSendTimeIsrael(now, WA_FOLLOWUP_QUIET_END_MINUTES);
  if (allowedAt.getTime() > now.getTime()) {
    logWaFollowupSkip("time_window", { next_allowed_at: allowedAt.toISOString() });
    return NextResponse.json({
      ok: true,
      skipped: true,
      dry_run: dryRun,
      reason: "outside_send_window",
      skip_reason: "time_window",
      next_allowed_at: allowedAt.toISOString(),
    });
  }

  const { runDueConversationFollowups } = await import("@/lib/business-conversation-flow");
  const nodeFollowups = await runDueConversationFollowups(admin, { now, dryRun });

  const nowIso = now.toISOString();
  const cutoff24hIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const cutoff20mIso = new Date(nowMs - WA_FOLLOWUP_MS_20_MIN).toISOString();

  const cancellations: FollowupCancellation[] = [];
  const wouldSend: Array<Record<string, unknown>> = [];
  const cancel = async (c: FollowupCancellation) => {
    cancellations.push(c);
    await recordFollowupCancellation(admin, { ...c, dryRun });
  };
  /** CAS on the due time read, so a lead writing meanwhile (trigger re-schedules) keeps the new series. */
  const closeOutsideWindow = async (row: Record<string, unknown>, stage: number) => {
    const due = String(row.wa_next_followup_at ?? "").trim();
    if (!due) return false;
    if (!dryRun) {
      const { error: closeErr } = await admin
        .from("contacts")
        .update({ wa_next_followup_at: null })
        .eq("id", row.id as string | number)
        .eq("wa_followup_stage", stage)
        .eq("wa_next_followup_at", due);
      if (closeErr) {
        console.error("[cron/wa-followups] outside_24h close failed:", closeErr.message);
        return false;
      }
    }
    await cancel({
      path: "wa_followups",
      businessId: Number(row.business_id) || null,
      phone: String(row.phone ?? ""),
      step: Math.min(3, stage + 1),
      reason: "outside_24h_window",
      dueAtIso: due,
    });
    return true;
  };

  // Follow-up series runs once per contact: locked contacts are read only while their series is in progress.
  const lockColumn = await followupSeriesLockColumnExists(admin);
  const lockSelect = lockColumn ? `, ${FOLLOWUP_SERIES_LOCK_COLUMN}` : "";
  let excludeMarketingOptOut = true;
  const withSeriesLockGate = <
    Q extends { or: (filters: string) => Q; eq: (column: string, value: boolean) => Q },
  >(
    q: Q
  ): Q => {
    const next = excludeMarketingOptOut ? q.eq("marketing_opted_out", false) : q;
    return lockColumn ? next.or(FOLLOWUP_SERIES_OPEN_OR_IN_PROGRESS) : next;
  };
  const followupSelect =
    "id, phone, full_name, business_id, wa_no_response_at, wa_next_followup_at, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, opted_out, trial_registered, session_phase, self_reported_registered_at, trial_signup_notice" +
    lockSelect;
  const followupSelectNoSelfReported =
    "id, phone, full_name, business_id, wa_no_response_at, wa_next_followup_at, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, opted_out, trial_registered, session_phase, trial_signup_notice" +
    lockSelect;

  let contacts: any[] | null = null;
  let error: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const primary = await withSeriesLockGate(
    admin
    .from("contacts")
    .select(followupSelect)
    .eq("source", "whatsapp")
    .or("opted_out.eq.false,opted_out.is.null")
    .is("not_relevant_at", null)
    .is("human_requested_at", null)
    .or("trial_registered.eq.false,trial_registered.is.null")
    .is("trial_signup_notice", null)
    .is("self_reported_registered_at", null)
    .lt("wa_followup_stage", 3)
    .not("wa_next_followup_at", "is", null)
    .lte("wa_next_followup_at", nowIso)
    .gte("wa_next_followup_at", cutoff24hIso)
    )
    .limit(BATCH);
    if (
      primary.error &&
      excludeMarketingOptOut &&
      /marketing_opted_out/i.test(String(primary.error.message ?? ""))
    ) {
      console.error(
        "[cron/wa-followups] contacts.marketing_opted_out missing — run supabase/contacts_marketing_opted_out.sql"
      );
      excludeMarketingOptOut = false;
      continue;
    }
    error = primary.error;
    contacts = (primary.data as any[] | null) ?? null;
    break;
  }

  if (error) {
    const msg = String(error.message ?? "");
    if (/self_reported_registered_at/i.test(msg)) {
      console.warn(
        "[cron/wa-followups] self_reported_registered_at missing — run supabase/contacts_cta_frequency_and_self_reported.sql"
      );
      const retry = await withSeriesLockGate(
        admin
        .from("contacts")
        .select(followupSelectNoSelfReported)
        .eq("source", "whatsapp")
        .or("opted_out.eq.false,opted_out.is.null")
        .is("not_relevant_at", null)
        .is("human_requested_at", null)
        .or("trial_registered.eq.false,trial_registered.is.null")
        .is("trial_signup_notice", null)
        .lt("wa_followup_stage", 3)
        .not("wa_next_followup_at", "is", null)
        .lte("wa_next_followup_at", nowIso)
        .gte("wa_next_followup_at", cutoff24hIso)
        )
        .limit(BATCH);
      if (retry.error) {
        console.error("[cron/wa-followups] contacts query (no self_reported):", retry.error);
        return NextResponse.json({ error: "query_failed" }, { status: 500 });
      }
      contacts = (retry.data as any[] | null) ?? null;
    } else if (/wa_next_followup_at|column/i.test(msg)) {
      const { data: legacy, error: legacyErr } = await withSeriesLockGate(
        admin
        .from("contacts")
        .select(followupSelect)
        .eq("source", "whatsapp")
        .or("opted_out.eq.false,opted_out.is.null")
        .is("not_relevant_at", null)
    .is("human_requested_at", null)
        .or("trial_registered.eq.false,trial_registered.is.null")
        .is("trial_signup_notice", null)
        .is("self_reported_registered_at", null)
        .lt("wa_followup_stage", 3)
        .not("last_contact_at", "is", null)
        .lt("last_contact_at", cutoff20mIso)
        .gte("last_contact_at", cutoff24hIso)
        )
        .limit(BATCH);
      if (legacyErr) {
        console.error("[cron/wa-followups] contacts query (legacy):", legacyErr);
        return NextResponse.json({ error: "query_failed" }, { status: 500 });
      }
      contacts = (legacy as any[] | null) ?? null;
    } else {
      console.error("[cron/wa-followups] contacts query:", error);
      return NextResponse.json({ error: "query_failed" }, { status: 500 });
    }
  } else {
    // לידים עם wa_next_followup_at ריק (לפני backfill / טריגר) — עדיין בתוך חלון 24ש׳ לפי last_contact_at
    const seen = new Set((contacts ?? []).map((c) => String((c as { id?: unknown }).id ?? "")));
    const room = Math.max(0, BATCH - (contacts?.length ?? 0));
    if (room > 0) {
      const { data: nullDueRows, error: nullDueErr } = await withSeriesLockGate(
        admin
        .from("contacts")
        .select(followupSelect)
        .eq("source", "whatsapp")
        .or("opted_out.eq.false,opted_out.is.null")
        .is("not_relevant_at", null)
    .is("human_requested_at", null)
        .or("trial_registered.eq.false,trial_registered.is.null")
        .is("trial_signup_notice", null)
        .is("self_reported_registered_at", null)
        .lt("wa_followup_stage", 3)
        .is("wa_next_followup_at", null)
        .is("wa_no_response_at", null)
        .not("last_contact_at", "is", null)
        .lt("last_contact_at", cutoff20mIso)
        .gte("last_contact_at", cutoff24hIso)
        )
        .limit(room);
      if (nullDueErr) {
        console.warn("[cron/wa-followups] null due-at supplement query:", nullDueErr.message);
      } else {
        for (const row of nullDueRows ?? []) {
          const id = String((row as { id?: unknown }).id ?? "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          contacts = [...(contacts ?? []), row];
        }
      }
    }
  }

  let examined = 0;
  let sent = 0;
  let skipped = 0;
  const skipCounts: Record<string, number> = {};

  const bumpSkip = (reason: WaFollowupSkipReason) => {
    skipped += 1;
    skipCounts[reason] = (skipCounts[reason] ?? 0) + 1;
  };

  // Due more than 24h ago: the main query never selects these. Close them on the due-time index.
  let staleQuery = admin
    .from("contacts")
    .select("id, phone, business_id, wa_next_followup_at, wa_followup_stage")
    .eq("source", "whatsapp")
    .or("opted_out.eq.false,opted_out.is.null")
    .is("not_relevant_at", null)
    .is("human_requested_at", null)
    .or("trial_registered.eq.false,trial_registered.is.null")
    .is("trial_signup_notice", null)
    .is("self_reported_registered_at", null)
    .is("wa_no_response_at", null)
    .lt("wa_followup_stage", 3)
    .not("wa_next_followup_at", "is", null)
    .lt("wa_next_followup_at", cutoff24hIso);
  if (excludeMarketingOptOut) staleQuery = staleQuery.eq("marketing_opted_out", false);
  if (lockColumn) staleQuery = staleQuery.or(FOLLOWUP_SERIES_OPEN_OR_IN_PROGRESS);
  const { data: staleRows, error: staleErr } = await staleQuery.limit(50);
  if (staleErr) {
    console.warn("[cron/wa-followups] stale due query:", staleErr.message);
  } else {
    for (const row of (staleRows ?? []) as Array<Record<string, unknown>>) {
      if (await closeOutsideWindow(row, Number(row.wa_followup_stage ?? 0) || 0)) bumpSkip("outside_24h_window");
    }
  }

  for (const c of contacts ?? []) {
    examined += 1;
    const contactId = (c as { id?: string | number }).id;
    const phone = String((c as { phone?: string }).phone ?? "").trim();
    const businessId = (c as { business_id?: number | null }).business_id;
    const noResponseAt = String((c as { wa_no_response_at?: string | null }).wa_no_response_at ?? "").trim();

    if (noResponseAt) {
      logWaFollowupSkip("no_response", {
        contact_id: contactId ?? null,
        phone: phone ? maskPhone(phone) : null,
        business_id: businessId ?? null,
        wa_no_response_at: noResponseAt,
      });
      bumpSkip("no_response");
      continue;
    }

    if (hasTrialSignupNotice((c as { trial_signup_notice?: string | null }).trial_signup_notice)) {
      logWaFollowupSkip("invalid_contact", {
        contact_id: contactId ?? null,
        phone: phone ? maskPhone(phone) : null,
        business_id: businessId ?? null,
        filtered_reason: "trial_signup_notice",
      });
      bumpSkip("invalid_contact");
      continue;
    }

    if (!phone || businessId == null) {
      logWaFollowupSkip("invalid_contact", {
        contact_id: contactId ?? null,
        phone: phone ? maskPhone(phone) : null,
        business_id: businessId ?? null,
      });
      bumpSkip("invalid_contact");
      continue;
    }

    const seriesGate = decideFollowupSeriesGate({
      lockColumn,
      lockedAt: (c as { followup_series_locked_at?: string | null }).followup_series_locked_at ?? null,
      stageCurrent: Number((c as { wa_followup_stage?: number | null }).wa_followup_stage ?? 0) || 0,
    });
    if (seriesGate === "locked") {
      logWaFollowupSkip("series_locked", {
        contact_id: contactId ?? null,
        phone: maskPhone(phone),
        business_id: businessId,
      });
      bumpSkip("series_locked");
      continue;
    }

    let claimedLockAt: string | null = null;
    let followupDelivered = false;
    try {
      const channel = await resolveSendChannelForContact(admin, businessId, phone);
      if (!channel?.phoneNumberId || !channel?.businessSlug) {
        logWaFollowupSkip("no_active_channel", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_id: businessId,
        });
        bumpSkip("no_active_channel");
        continue;
      }

      const { data: bizRow } = await admin
        .from("businesses")
        .select("is_active, name, bot_name, social_links")
        .eq("id", businessId)
        .maybeSingle();
      if (!isBusinessSubscriptionActive((bizRow ?? {}) as { is_active?: boolean | null })) {
        logWaFollowupSkip("no_active_channel", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_id: businessId,
          detail: "business_inactive",
        });
        bumpSkip("no_active_channel");
        continue;
      }

      const business_slug = String(channel.businessSlug).trim().toLowerCase();
      const { businessUsesConversationFollowupNodes, businessUsesNodeConversation } = await import(
        "@/lib/sales-flow-start-triggers"
      );
      if (businessUsesConversationFollowupNodes(business_slug)) {
        logWaFollowupSkip("node_followups", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          detail: "conversation_nodes",
        });
        bumpSkip("node_followups");
        continue;
      }
      const phoneNumberId = String(channel.phoneNumberId).trim();
      const sessionId = buildWaSessionId(phoneNumberId, phone);
      const sessionIds = waSessionIdLookupVariants(phoneNumberId, phone);

      const startedInBoxes =
        businessUsesNodeConversation(business_slug) &&
        (await hasConversationBoxSession({ admin, businessId: Number(businessId), phone }));
      if (
        !startedInBoxes &&
        !(await sessionHasSalesFlowGreeting({
          business_slug,
          session_id: sessionIds.length ? sessionIds : sessionId,
        }))
      ) {
        logWaFollowupSkip("sales_flow_not_started", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
        });
        bumpSkip("sales_flow_not_started");
        continue;
      }

      const { isWaFollowupBlockedByAppPause } = await import("@/lib/wa-app-echo-pause");
      if (
        await isWaFollowupBlockedByAppPause({
          admin,
          businessSlug: business_slug,
          phoneNumberId,
          phone,
        })
      ) {
        logWaFollowupSkip("session_paused", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
        });
        bumpSkip("session_paused");
        continue;
      }

      const lastAssist = await fetchLatestRealAssistantMessageAt({ admin, business_slug, session_ids: sessionIds });
      if (!lastAssist) {
        logWaFollowupSkip("no_assistant_message", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          session_id_variants: sessionIds,
        });
        bumpSkip("no_assistant_message");
        continue;
      }

      const lastAssistAtIso = lastAssist.created_at;
      if (!lastAssistAtIso) {
        logWaFollowupSkip("no_assistant_message", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          detail: "missing_assistant_timestamp",
        });
        bumpSkip("no_assistant_message");
        continue;
      }

      const lastUserAtIso = await fetchLatestUserMessageAt({ admin, business_slug, session_ids: sessionIds });
      if (!lastUserAtIso) {
        logWaFollowupSkip("no_user_message", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
        });
        bumpSkip("no_user_message");
        continue;
      }

      const hoursSinceUser = (nowMs - new Date(lastUserAtIso).getTime()) / (1000 * 60 * 60);
      if (isOutsideLeadWindow(new Date(lastUserAtIso), now)) {
        const stageForClose = Number((c as { wa_followup_stage?: number | null }).wa_followup_stage ?? 0) || 0;
        const closed = await closeOutsideWindow(c as Record<string, unknown>, stageForClose);
        logWaFollowupSkip(closed ? "outside_24h_window" : "over_24h", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          hours_since_user: hoursSinceUser,
          last_user_at: lastUserAtIso,
        });
        bumpSkip(closed ? "outside_24h_window" : "over_24h");
        continue;
      }

      if (await hasUserReplyAfter({ admin, business_slug, session_ids: sessionIds, afterIso: lastAssistAtIso })) {
        logWaFollowupSkip("already_replied", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          last_assistant_at: lastAssistAtIso,
        });
        bumpSkip("already_replied");
        continue;
      }

      const elapsedMs = nowMs - new Date(lastAssistAtIso).getTime();
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        logWaFollowupSkip("not_due_yet", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          detail: "invalid_elapsed",
          elapsed_ms: elapsedMs,
          last_assistant_at: lastAssistAtIso,
        });
        bumpSkip("not_due_yet");
        continue;
      }

      const stageCurrent = Number((c as { wa_followup_stage?: number | null }).wa_followup_stage ?? 0) || 0;
      const socialLinks = (bizRow as { social_links?: unknown } | null)?.social_links;
      const enabled = resolveWaSalesFollowupEnabled(socialLinks);
      let plan = resolveWaFollowupSendPlan({ stageCurrent, elapsedMs, enabled });

      // Steps 1–2 held by the night / Shabbat window are never sent late.
      let stageAfterCancel = stageCurrent;
      while (plan.sendStage === 1 || plan.sendStage === 2) {
        const dueAt = new Date(new Date(lastAssistAtIso).getTime() + WA_FOLLOWUP_STEP_OFFSET_MS[plan.sendStage]);
        const decision = decideFollowupStep({
          finalStep: false,
          dueAt,
          now,
          lastUserAt: new Date(lastUserAtIso),
          quietEndMinutes: WA_FOLLOWUP_QUIET_END_MINUTES,
        });
        if (decision.action === "send") break;
        await cancel({
          path: "wa_followups",
          businessId: Number(businessId),
          phone,
          step: plan.sendStage,
          reason: decision.reason,
          dueAtIso: dueAt.toISOString(),
        });
        stageAfterCancel = plan.sendStage;
        plan = resolveWaFollowupSendPlan({ stageCurrent: stageAfterCancel, elapsedMs, enabled });
      }
      if (stageAfterCancel > stageCurrent && !dryRun) {
        const { error: advanceErr } = await admin
          .from("contacts")
          .update({ wa_followup_stage: stageAfterCancel })
          .eq("id", contactId as string | number)
          .eq("wa_followup_stage", stageCurrent);
        if (advanceErr) console.error("[cron/wa-followups] delayed step advance failed:", advanceErr.message);
      }

      if (plan.sendStage === 0) {
        if (plan.advanceToStage > stageAfterCancel) {
          if (!dryRun) {
            await admin.from("contacts").update({ wa_followup_stage: plan.advanceToStage }).eq("id", contactId);
          }
          if (plan.advanceToStage === 3 && !dryRun) {
            const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
            await dispatchCrmEvent({
              businessId: Number(businessId),
              leadPhone: phone,
              kind: "no_response",
              fullName: String((c as { full_name?: string | null }).full_name ?? "").trim() || null,
              eventAtIso: new Date().toISOString(),
            }).catch((e) => console.error("[cron/wa-followups] CRM dispatch failed:", e));
          }
          logWaFollowupSkip("stage_disabled", {
            contact_id: contactId,
            phone: maskPhone(phone),
            business_slug,
            session_id: sessionId,
            wa_followup_stage: stageCurrent,
            advance_to_stage: plan.advanceToStage,
            enabled,
          });
          bumpSkip("stage_disabled");
          continue;
        }
        if (stageAfterCancel > stageCurrent) {
          bumpSkip("delayed_step_cancelled");
          continue;
        }
        logWaFollowupSkip("not_due_yet", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          last_assistant_at: lastAssistAtIso,
          last_assistant_model: lastAssist.model_used,
          ...notDueYetDetail(stageCurrent, elapsedMs),
        });
        bumpSkip("not_due_yet");
        continue;
      }

      const nextStage = plan.sendStage;
      if (!isWaSalesFollowupStageEnabled(enabled, nextStage)) {
        console.error("[cron/wa-followups] refused send of disabled stage", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          next_stage: nextStage,
          enabled,
        });
        bumpSkip("stage_disabled");
        continue;
      }

      if (dryRun) {
        wouldSend.push({
          path: "wa_followups",
          business_slug,
          phone: maskPhone(phone),
          step: nextStage,
          due_at: new Date(new Date(lastAssistAtIso).getTime() + WA_FOLLOWUP_STEP_OFFSET_MS[nextStage]).toISOString(),
          hours_since_user: Math.round(hoursSinceUser * 100) / 100,
        });
        continue;
      }

      const businessName = String((bizRow as { name?: string } | null)?.name ?? "").trim() || business_slug;
      const botName = String((bizRow as { bot_name?: string } | null)?.bot_name ?? "").trim() || "זואי";
      // מספר שירות הלקוחות של העסק (טאב «על העסק») — לא מספר הוואטסאפ של זואי (phone_display)
      const csPhone = customerServicePhoneFromSocialLinks(socialLinks);

      const vars = {
        bot_name: botName,
        business_name: businessName,
        phone: csPhone || "",
        service_phone_note: csPhone ? `\n\nניתן גם להתקשר ל:${csPhone}` : "",
      };

      const { t1, t2, t3 } = resolveWaSalesFollowupTemplates(socialLinks);
      let chosenTemplate = nextStage === 1 ? t1 : nextStage === 2 ? t2 : t3;
      // אין מספר שירות לקוחות → להשמיט את פסוקית הטלפון במקום משפט קטוע
      if (!csPhone) chosenTemplate = stripPhonePlaceholderClauseWhenEmpty(chosenTemplate);
      const raw = fillTemplate(chosenTemplate, vars);
      const bodyCore = raw.trim();
      const sessionPhase = String((c as { session_phase?: string | null }).session_phase ?? "").trim();
      const cta = await resolveWaFollowupCta({
        admin,
        businessId: Number(businessId),
        business_slug,
        session_ids: sessionIds,
        social_links: socialLinks,
        session_phase: sessionPhase || null,
      });

      if (seriesGate === "start_series" && contactId != null) {
        const claimAtIso = new Date().toISOString();
        const claim = await claimFollowupSeriesStart({ admin, contactId, nowIso: claimAtIso });
        if (claim.claimed) claimedLockAt = claimAtIso;
        if (!claim.claimed) {
          logWaFollowupSkip("series_locked", {
            contact_id: contactId,
            phone: maskPhone(phone),
            business_slug,
            detail: claim.error ? "claim_failed" : "locked_meanwhile",
          });
          bumpSkip("series_locked");
          continue;
        }
      }

      await withWaMessageLogScope({ businessSlug: business_slug, sessionId }, async () => {
      await sendWhatsAppIdleFollowupMessage(
        phoneNumberId,
        phone,
        bodyCore,
        FOLLOWUP_FOOTER,
        cta,
        accountSid,
        authToken
      );
      followupDelivered = true;

      let logContent = `${bodyCore}${FOLLOWUP_FOOTER}`;
      if (cta?.mode === "url") logContent += `\n\n[כפתור: ${cta.label} → ${cta.url}]`;
      else if (cta?.mode === "reply") logContent += `\n\n[כפתור: ${cta.label}]`;

      await logMessage({
        business_slug,
        role: "assistant",
        content: logContent,
        model_used: `wa_followup_${nextStage}`,
        session_id: sessionId,
      });
      });

      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> = { wa_followup_stage: nextStage };
      if (nextStage === 1) patch.wa_followup_1_sent_at = nowIso;
      if (nextStage === 2) patch.wa_followup_2_sent_at = nowIso;
      if (nextStage === 3) patch.wa_followup_3_sent_at = nowIso;

      await admin.from("contacts").update(patch).eq("id", contactId);

      if (nextStage === 3) {
        const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
        await dispatchCrmEvent({
          businessId: Number(businessId),
          leadPhone: phone,
          kind: "no_response",
          fullName: String((c as { full_name?: string | null }).full_name ?? "").trim() || null,
          eventAtIso: nowIso,
        }).catch((e) => console.error("[cron/wa-followups] CRM dispatch failed:", e));
      }

      sent += 1;
    } catch (e) {
      console.error("[cron/wa-followups] failed:", e);
      logWaFollowupSkip("send_failed", {
        contact_id: contactId,
        phone: maskPhone(phone),
        business_id: businessId,
        error: e instanceof Error ? e.message : String(e),
      });
      bumpSkip("send_failed");
      if (claimedLockAt && !followupDelivered && contactId != null) {
        const release = await releaseFollowupSeriesClaim({
          admin,
          contactId,
          claimedAtIso: claimedLockAt,
          dueWasSet: Boolean((c as { wa_next_followup_at?: string | null }).wa_next_followup_at),
        });
        console.info("[cron/wa-followups] series claim after failed send", {
          contact_id: contactId,
          released: release.released,
          error: release.error ?? null,
        });
      }
    }
  }

  const cancelledCounts: Record<string, number> = {};
  for (const c of cancellations) cancelledCounts[c.reason] = (cancelledCounts[c.reason] ?? 0) + 1;

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    now: nowIso,
    examined,
    sent,
    skipped,
    skip_counts: skipCounts,
    cancelled: cancelledCounts,
    node_followups: nodeFollowups,
    inbound_replays: inboundReplays,
    ...(dryRun
      ? {
          would_send: wouldSend,
          would_cancel: cancellations.map((c) => ({ ...c, phone: maskFollowupPhone(c.phone) })),
        }
      : {}),
  });
}
