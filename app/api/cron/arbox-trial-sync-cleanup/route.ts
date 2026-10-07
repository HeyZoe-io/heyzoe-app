import { NextRequest, NextResponse } from "next/server";
import {
  ARBOX_SYNC_LOG_DELETE_BATCH,
  ARBOX_SYNC_LOG_DELETE_MAX_BATCHES,
  ARBOX_SYNC_LOG_RETENTION_TARGETS,
  isMissingSyncLogTable,
  retentionCutoffIso,
  type SyncLogRetentionTarget,
} from "@/lib/leads/arbox-sync-log-retention";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET יומי + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/arbox-trial-sync-cleanup] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

type TableResult = {
  table: string;
  retention_days: number;
  cutoff: string;
  deleted: number;
  more_remaining: boolean;
  skipped?: "missing_table";
  error?: string;
};

async function deleteOlderRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  target: SyncLogRetentionTarget,
  cutoff: string
): Promise<TableResult> {
  const result: TableResult = {
    table: target.table,
    retention_days: target.retentionDays,
    cutoff,
    deleted: 0,
    more_remaining: false,
  };

  for (let batch = 0; batch < ARBOX_SYNC_LOG_DELETE_MAX_BATCHES; batch += 1) {
    let query = admin.from(target.table).delete({ count: "exact" }).lt(target.timeColumn, cutoff);
    for (const keep of target.keep) {
      query = query.neq(keep.column, keep.not);
    }
    const { error, count } = await query.limit(ARBOX_SYNC_LOG_DELETE_BATCH);
    if (error) {
      if (isMissingSyncLogTable(error.message)) {
        result.skipped = "missing_table";
        return result;
      }
      result.error = error.message;
      return result;
    }
    const deleted = count ?? 0;
    result.deleted += deleted;
    if (deleted < ARBOX_SYNC_LOG_DELETE_BATCH) return result;
  }

  result.more_remaining = true;
  return result;
}

/**
 * מוחק שורות ישנות מלוגי הסנכרון של ארבוקס.
 * arbox_trial_sync_log נשאר 90 יום. טבלאות עם חלון דה-דופ קצר מ-90 מצטרפות לאותו ג'וב.
 * יום הולדת נשמר 400 יום. סנטינלים (user/lead/hold 0, ו-pending של סטטוס ליד) לא נמחקים.
 * Scheduling: external cron-job.org (not Vercel crons). Same URL as before.
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-trial-sync-cleanup] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ranAt = new Date().toISOString();

  try {
    const admin = createSupabaseAdminClient();
    const tables: TableResult[] = [];
    for (const target of ARBOX_SYNC_LOG_RETENTION_TARGETS) {
      const cutoff = retentionCutoffIso(target.retentionDays);
      const result = await deleteOlderRows(admin, target, cutoff);
      tables.push(result);
      if (result.error) {
        console.error("[cron/arbox-trial-sync-cleanup] delete failed", {
          table: target.table,
          error: result.error,
          deleted: result.deleted,
        });
      } else if (result.skipped) {
        console.error("[cron/arbox-trial-sync-cleanup] table missing", { table: target.table });
      } else {
        console.info("[cron/arbox-trial-sync-cleanup] table", {
          table: target.table,
          deleted: result.deleted,
          cutoff,
          retention_days: target.retentionDays,
          more_remaining: result.more_remaining,
        });
      }
    }

    const deletedCount = tables.reduce((sum, row) => sum + row.deleted, 0);
    const failed = tables.filter((row) => row.error);
    if (failed.length) {
      return NextResponse.json(
        { ok: false, deleted_count: deletedCount, tables, ran_at: ranAt },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      deleted_count: deletedCount,
      tables,
      ran_at: ranAt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-trial-sync-cleanup] unexpected error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
