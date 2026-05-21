import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAllowedWhatsAppSendTimeIsrael, nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import {
  markMarketingFollowupSent,
  pickMarketingFollowupStage,
  sendMarketingFollowupStage,
  sessionHasMarketingRegisteredMessage,
  type MarketingFlowSessionFollowupRow,
} from "@/lib/marketing-followups";
import { marketingWaSessionId } from "@/lib/marketing-whatsapp";
import { resolveCronSecret } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 200;

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

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  if (!isAllowedWhatsAppSendTimeIsrael(now)) {
    const nextAt = nextAllowedWhatsAppSendTimeIsrael(now);
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_send_window",
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

  for (const raw of rows ?? []) {
    examined += 1;
    const row = raw as MarketingFlowSessionFollowupRow;
    const phone = String(row.phone ?? "").trim();
    if (!phone) {
      skipped += 1;
      continue;
    }

    try {
      const sessionId = marketingWaSessionId(phone);
      if (await sessionHasMarketingRegisteredMessage(sessionId)) {
        await admin
          .from("marketing_flow_sessions")
          .update({ followup_opted_out: true, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        skipped += 1;
        continue;
      }

      const stage = pickMarketingFollowupStage(row, nowMs);
      if (stage === 0) {
        skipped += 1;
        continue;
      }

      await sendMarketingFollowupStage(phone, stage);
      await markMarketingFollowupSent(row.id, stage);
      sent += 1;
    } catch (e) {
      console.error("[cron/marketing-followups] failed for", phone, e);
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, examined, sent, skipped });
}
