import { NextRequest, NextResponse } from "next/server";
import { acknowledgeCron, cronDryRunNow, rejectCronTimeOverride } from "@/lib/cron-clock";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAllowedWhatsAppSendTimeIsrael, nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import {
  loadMarketingFollowupConfig,
  markMarketingFollowupSent,
  pickMarketingFollowupSkipReason,
  pickMarketingFollowupStage,
  markMarketingFollowupOptedOut,
  markMarketingFollowupSkipped,
  isMissingFollowupSkippedColumn,
  sendMarketingFollowupStage,
  sessionHasMarketingRegisteredMessage,
  type MarketingFlowSessionFollowupRow,
} from "@/lib/marketing-followups";
import {
  decideFollowupStep,
  maskFollowupPhone,
  recordFollowupCancellation,
  type FollowupCancellation,
} from "@/lib/followup-hold-policy";
import {
  marketingFollowupDelaysMs,
  marketingFollowupEnabled,
} from "@/lib/marketing-followup-config";
import { isMarketingPipelineDropStatus, pipelineStatusStopsFollowups } from "@/lib/marketing-pipeline-status";
import { isMarketingConversationPaused, marketingWaSessionId } from "@/lib/marketing-whatsapp";
import { resolveCronSecret } from "@/lib/server-env";

/**
 * נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). הגדרה: GET כל ~5 דק׳ + Authorization: Bearer CRON_SECRET
 * `dry_run=1` (אופציונלי `now=ISO`): בלי שליחה ובלי עדכונים. מחזיר would_send / would_cancel.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 200;

type MarketingFollowupSkipReason =
  | "time_window"
  | "missing_phone"
  | "registered"
  | "paused"
  | "not_due_yet"
  | "all_followups_sent"
  | "no_user_message_at"
  | "invalid_timestamp"
  | "send_failed"
  | "human_followup"
  | "stages_disabled"
  | "delayed_step_cancelled"
  | "outside_24h_window";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/marketing-followups] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function logMarketingFollowupSkip(
  reason: MarketingFollowupSkipReason,
  meta: Record<string, unknown>
): void {
  console.info("[cron/marketing-followups] skip", { skip_reason: reason, ...meta });
}

function maskPhone(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rejectedClock = rejectCronTimeOverride(req, true);
  if (rejectedClock) return rejectedClock;
  await acknowledgeCron(req, "/api/cron/marketing-followups");
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";

  const now = (dryRun ? cronDryRunNow(req) : undefined) ?? new Date();
  if (!isAllowedWhatsAppSendTimeIsrael(now)) {
    const nextAt = nextAllowedWhatsAppSendTimeIsrael(now);
    logMarketingFollowupSkip("time_window", { next_allowed_at: nextAt.toISOString() });
    return NextResponse.json({
      ok: true,
      skipped: true,
      dry_run: dryRun,
      reason: "outside_send_window",
      skip_reason: "time_window",
      next_allowed_at: nextAt.toISOString(),
    });
  }

  const admin = createSupabaseAdminClient();
  const nowMs = now.getTime();
  const followupConfig = await loadMarketingFollowupConfig();
  const delaysMs = marketingFollowupDelaysMs(followupConfig);
  const enabled = marketingFollowupEnabled(followupConfig);

  let rows: MarketingFlowSessionFollowupRow[] | null = null;
  const selectWithHuman =
    "id, phone, last_user_message_at, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at, followup_opted_out, flow_completed, human_followup_at, pipeline_status";
  const openRows = (columns: string) =>
    admin
      .from("marketing_flow_sessions")
      .select(columns)
      .eq("flow_completed", false)
      .eq("followup_opted_out", false)
      .is("human_followup_at", null)
      .not("last_user_message_at", "is", null)
      .limit(BATCH);
  let withHuman = await openRows(
    `${selectWithHuman}, followup_1_skipped_at, followup_2_skipped_at, followup_3_skipped_at`
  );
  if (withHuman.error && isMissingFollowupSkippedColumn(withHuman.error.message)) {
    console.error(
      "[cron/marketing-followups] followup_N_skipped_at missing — run supabase/marketing_flow_sessions_followup_skipped.sql"
    );
    withHuman = await openRows(selectWithHuman);
  }

  if (!withHuman.error) {
    rows = (withHuman.data ?? []) as unknown as MarketingFlowSessionFollowupRow[];
  } else if (/human_followup_at|column/i.test(String(withHuman.error.message ?? ""))) {
    const fallback = await admin
      .from("marketing_flow_sessions")
      .select(
        "id, phone, last_user_message_at, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at, followup_opted_out, flow_completed"
      )
      .eq("flow_completed", false)
      .eq("followup_opted_out", false)
      .not("last_user_message_at", "is", null)
      .limit(BATCH);
    if (fallback.error) {
      if (/last_user_message_at|followup_|column/i.test(String(fallback.error.message ?? ""))) {
        return NextResponse.json({ ok: true, skipped: true, reason: "columns_missing" });
      }
      console.error("[cron/marketing-followups] query:", fallback.error);
      return NextResponse.json({ error: "query_failed" }, { status: 500 });
    }
    rows = (fallback.data ?? []) as MarketingFlowSessionFollowupRow[];
  } else if (/last_user_message_at|followup_|column/i.test(String(withHuman.error.message ?? ""))) {
    return NextResponse.json({ ok: true, skipped: true, reason: "columns_missing" });
  } else {
    console.error("[cron/marketing-followups] query:", withHuman.error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  let examined = 0;
  let sent = 0;
  let skipped = 0;
  const skipCounts: Record<string, number> = {};

  const bumpSkip = (reason: MarketingFollowupSkipReason) => {
    skipped += 1;
    skipCounts[reason] = (skipCounts[reason] ?? 0) + 1;
  };
  const cancellations: FollowupCancellation[] = [];
  const wouldSend: Array<Record<string, unknown>> = [];

  for (const raw of rows ?? []) {
    examined += 1;
    const row = raw as MarketingFlowSessionFollowupRow;
    const phone = String(row.phone ?? "").trim();
    if (!phone) {
      logMarketingFollowupSkip("missing_phone", { session_id: row.id });
      bumpSkip("missing_phone");
      continue;
    }

    const sessionId = marketingWaSessionId(phone);

    try {
      const statusStops =
        isMarketingPipelineDropStatus(row.pipeline_status) &&
        pipelineStatusStopsFollowups(row.pipeline_status);
      if (row.human_followup_at || statusStops) {
        if (!dryRun) await markMarketingFollowupOptedOut(phone);
        logMarketingFollowupSkip("human_followup", {
          session_id: row.id,
          phone: maskPhone(phone),
          marketing_session_id: sessionId,
          pipeline_status: row.pipeline_status ?? null,
        });
        bumpSkip("human_followup");
        continue;
      }

      if (await isMarketingConversationPaused(phone)) {
        if (!dryRun) await markMarketingFollowupOptedOut(phone);
        logMarketingFollowupSkip("paused", {
          session_id: row.id,
          phone: maskPhone(phone),
          marketing_session_id: sessionId,
        });
        bumpSkip("paused");
        continue;
      }

      if (await sessionHasMarketingRegisteredMessage(sessionId)) {
        if (!dryRun) {
          await admin
            .from("marketing_flow_sessions")
            .update({ followup_opted_out: true, updated_at: new Date().toISOString() })
            .eq("id", row.id);
        }
        logMarketingFollowupSkip("registered", {
          session_id: row.id,
          phone: maskPhone(phone),
          marketing_session_id: sessionId,
        });
        bumpSkip("registered");
        continue;
      }

      let stage = pickMarketingFollowupStage(row, nowMs, delaysMs, enabled);
      // 24h window before every send; steps 1–2 held by the night / Shabbat window are not sent late.
      let cancelReason: "delayed_step_cancelled" | "outside_24h_window" | null = null;
      const lastUserMs = row.last_user_message_at ? new Date(row.last_user_message_at).getTime() : NaN;
      while (stage !== 0) {
        const decision = decideFollowupStep({
          finalStep: stage === 3,
          dueAt: new Date(lastUserMs + delaysMs[stage - 1]!),
          now,
          lastUserAt: Number.isFinite(lastUserMs) ? new Date(lastUserMs) : null,
        });
        if (decision.action === "send") break;
        cancelReason = decision.reason;
        const toClose = (decision.reason === "outside_24h_window" ? ([1, 2, 3] as const) : [stage]).filter(
          (s) => s >= stage && enabled[s - 1] && !row[`followup_${s}_sent_at`] && !row[`followup_${s}_skipped_at`]
        );
        for (const s of toClose) {
          const dueAtIso = new Date(lastUserMs + delaysMs[s - 1]!).toISOString();
          if (!dryRun) await markMarketingFollowupSkipped(row.id, s, dueAtIso);
          row[`followup_${s}_skipped_at`] = now.toISOString();
          const c: FollowupCancellation = {
            path: "marketing",
            businessId: null,
            phone,
            step: s,
            reason: decision.reason,
            dueAtIso,
          };
          cancellations.push(c);
          await recordFollowupCancellation(admin, { ...c, dryRun });
        }
        stage = decision.reason === "outside_24h_window" ? 0 : pickMarketingFollowupStage(row, nowMs, delaysMs, enabled);
      }
      if (stage === 0 && cancelReason) {
        bumpSkip(cancelReason);
        continue;
      }
      if (stage === 0) {
        const skipReason = pickMarketingFollowupSkipReason(row, nowMs, delaysMs, enabled);
        const reason: MarketingFollowupSkipReason =
          skipReason === "all_followups_sent"
            ? "all_followups_sent"
            : skipReason === "stages_disabled"
              ? "stages_disabled"
              : skipReason === "no_user_message_at"
                ? "no_user_message_at"
                : skipReason === "invalid_timestamp"
                  ? "invalid_timestamp"
                  : "not_due_yet";

        const lastAt = row.last_user_message_at ? new Date(row.last_user_message_at).getTime() : NaN;
        logMarketingFollowupSkip(reason, {
          session_id: row.id,
          phone: maskPhone(phone),
          marketing_session_id: sessionId,
          last_user_message_at: row.last_user_message_at,
          elapsed_ms: Number.isFinite(lastAt) ? nowMs - lastAt : null,
          followup_1_sent_at: row.followup_1_sent_at,
          followup_2_sent_at: row.followup_2_sent_at,
          followup_3_sent_at: row.followup_3_sent_at,
          pick_skip_reason: skipReason,
        });
        bumpSkip(reason);
        continue;
      }

      if (dryRun) {
        wouldSend.push({
          path: "marketing",
          phone: maskPhone(phone),
          step: stage,
          due_at: new Date(lastUserMs + delaysMs[stage - 1]!).toISOString(),
          hours_since_user: Math.round(((nowMs - lastUserMs) / 36e5) * 100) / 100,
        });
        continue;
      }

      const sendResult = await sendMarketingFollowupStage(
        phone,
        stage,
        followupConfig.stages[stage - 1].text
      );
      if (sendResult === "outside_window") {
        logMarketingFollowupSkip("time_window", {
          session_id: row.id,
          phone: maskPhone(phone),
          stage,
          next_allowed_at: nextAllowedWhatsAppSendTimeIsrael(new Date()).toISOString(),
        });
        bumpSkip("time_window");
        break;
      }
      await markMarketingFollowupSent(row.id, stage);
      sent += 1;
    } catch (e) {
      console.error("[cron/marketing-followups] failed for", phone, e);
      logMarketingFollowupSkip("send_failed", {
        session_id: row.id,
        phone: maskPhone(phone),
        marketing_session_id: sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
      bumpSkip("send_failed");
    }
  }

  const cancelledCounts: Record<string, number> = {};
  for (const c of cancellations) cancelledCounts[c.reason] = (cancelledCounts[c.reason] ?? 0) + 1;

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    now: now.toISOString(),
    examined,
    sent,
    skipped,
    skip_counts: skipCounts,
    cancelled: cancelledCounts,
    ...(dryRun
      ? {
          would_send: wouldSend,
          would_cancel: cancellations.map((c) => ({ ...c, phone: maskFollowupPhone(c.phone) })),
        }
      : {}),
  });
}
