import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { loadMarketingFlowBundle, processMarketingFollowupDue } from "@/lib/marketing-flow-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const bundle = await loadMarketingFlowBundle(admin);
  if (!bundle.channel?.is_active || !bundle.settings?.is_active) {
    return NextResponse.json({ ok: true, processed: 0, reason: "inactive" });
  }

  const nowIso = new Date().toISOString();
  const { data: due } = await admin
    .from("marketing_flow_sessions")
    .select("id")
    .not("followup_wake_at", "is", null)
    .lte("followup_wake_at", nowIso)
    .limit(25);

  let processed = 0;
  for (const row of due ?? []) {
    const id = Number((row as any).id);
    if (!Number.isFinite(id)) continue;
    try {
      const ok = await processMarketingFollowupDue(admin, id);
      if (ok) processed++;
    } catch (e) {
      console.error("[cron/marketing-followup] session", id, e);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
