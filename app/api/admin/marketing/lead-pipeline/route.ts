import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { updateMarketingLeadPipeline } from "@/lib/marketing-lead-pipeline";
import {
  isMarketingPipelineDropStatus,
  type MarketingPipelineDropStatus,
} from "@/lib/marketing-pipeline-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    phone?: string;
    human_followup?: boolean;
    status?: string;
    next_call_at?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const phone = String(body.phone ?? "").trim();
  if (!phone) {
    return NextResponse.json({ error: "missing_phone" }, { status: 400 });
  }

  const status: MarketingPipelineDropStatus | undefined = isMarketingPipelineDropStatus(body.status)
    ? body.status
    : undefined;
  if (body.status != null && body.status !== "" && !status) {
    return NextResponse.json({ error: "unsupported_status" }, { status: 400 });
  }
  if (status == null && typeof body.human_followup !== "boolean") {
    return NextResponse.json({ error: "missing_status" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const result = await updateMarketingLeadPipeline(admin, phone, {
      status,
      human_followup: body.human_followup,
      next_call_at: body.next_call_at,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const code = e instanceof Error ? e.message : "update_failed";
    const statusCode =
      code === "lead_not_found" ? 404 : code === "migration_required" ? 409 : code === "unsupported_status" ? 400 : 500;
    console.error("[admin/marketing/lead-pipeline] POST failed:", code);
    return NextResponse.json({ error: code }, { status: statusCode });
  }
}
