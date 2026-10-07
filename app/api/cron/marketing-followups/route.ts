import { NextRequest, NextResponse } from "next/server";
import { acknowledgeCron, rejectCronTimeOverride } from "@/lib/cron-clock";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAllowedWhatsAppSendTimeIsrael, nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import {
  loadMarketingFollowupConfig,
  markMarketingFollowupSent,
  pickMarketingFollowupSkipReason,
  pickMarketingFollowupStage,
  markMarketingFollowupOptedOut,
  sendMarketingFollowupStage,
  sessionHasMarketingRegisteredMessage,
  type MarketingFlowSessionFollowupRow,
} from "@/lib/marketing-followups";
import {
  marketingFollowupDelaysMs,
  marketingFollowupEnabled,
} from "@/lib/marketing-followup-config";
import { isMarketingPipelineDropStatus, pipelineStatusStopsFollowups } from "@/lib/marketing-pipeline-status";
import { isMarketingConversationPaused, marketingWaSessionId } from "@/lib/marketing-whatsapp";
import { resolveCronSecret } from "@/lib/server-env";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). הגדרה: GET כל ~5 דק׳ + Authorization: Bearer CRON_SECRET */
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
  | "stages_disabled";

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
  const rejectedClock = rejectCronTimeOverride(req);
  if (rejectedClock) return rejectedClock;
  await acknowledgeCron(req, "/api/cron/marketing-followups");


  const now = new Date();
  if (!isAllowedWhatsAppSendTimeIsrael(now)) {
    const nextAt = nextAllowedWhatsAppSendTimeIsrael(now);
    logMarketingFollowupSkip("time_window", { next_allowed_at: nextAt.toISOString() });
    return NextResponse.json({
      ok: true,
      skipped: true,
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
  const withHuman = await admin
    .from("marketing_flow_sessions")
    .select(
      "id, phone, last_user_message_at, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at, followup_opted_out, flow_completed, human_followup_at, pipeline_status"
    )
    .eq("flow_completed", false)
    .eq("followup_opted_out", false)
    .is("human_followup_at", null)
    .not("last_user_message_at", "is", null)
    .limit(BATCH);

  if (!withHuman.error) {
    rows = (withHuman.data ?? []) as MarketingFlowSessionFollowupRow[];
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
        await markMarketingFollowupOptedOut(phone);
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
        await markMarketingFollowupOptedOut(phone);
        logMarketingFollowupSkip("paused", {
          session_id: row.id,
          phone: maskPhone(phone),
          marketing_session_id: sessionId,
        });
        bumpSkip("paused");
        continue;
      }

      if (await sessionHasMarketingRegisteredMessage(sessionId)) {
        await admin
          .from("marketing_flow_sessions")
          .update({ followup_opted_out: true, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        logMarketingFollowupSkip("registered", {
          session_id: row.id,
          phone: maskPhone(phone),
          marketing_session_id: sessionId,
        });
        bumpSkip("registered");
        continue;
      }

      const stage = pickMarketingFollowupStage(row, nowMs, delaysMs, enabled);
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

  return NextResponse.json({ ok: true, examined, sent, skipped, skip_counts: skipCounts });
}
