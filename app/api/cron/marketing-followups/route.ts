import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAllowedWhatsAppSendTimeIsrael, nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import {
  markMarketingFollowupSent,
  pickMarketingFollowupSkipReason,
  pickMarketingFollowupStage,
  sendMarketingFollowupStage,
  sessionHasMarketingRegisteredMessage,
  type MarketingFlowSessionFollowupRow,
} from "@/lib/marketing-followups";
import { marketingWaSessionId } from "@/lib/marketing-whatsapp";
import { resolveCronSecret } from "@/lib/server-env";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). הגדרה: GET כל ~5 דק׳ + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 200;

type MarketingFollowupSkipReason =
  | "time_window"
  | "missing_phone"
  | "registered"
  | "not_due_yet"
  | "all_followups_sent"
  | "no_user_message_at"
  | "invalid_timestamp"
  | "send_failed";

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

  const { data: rows, error } = await admin
    .from("marketing_flow_sessions")
    .select(
      "id, phone, last_user_message_at, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at, followup_opted_out, flow_completed"
    )
    .eq("flow_completed", false)
    .eq("followup_opted_out", false)
    .not("last_user_message_at", "is", null)
    .limit(BATCH);

  if (error) {
    if (/last_user_message_at|followup_|column/i.test(String(error.message ?? ""))) {
      return NextResponse.json({ ok: true, skipped: true, reason: "columns_missing" });
    }
    console.error("[cron/marketing-followups] query:", error);
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

      const stage = pickMarketingFollowupStage(row, nowMs);
      if (stage === 0) {
        const skipReason = pickMarketingFollowupSkipReason(row, nowMs);
        const reason: MarketingFollowupSkipReason =
          skipReason === "all_followups_sent"
            ? "all_followups_sent"
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

      await sendMarketingFollowupStage(phone, stage);
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
