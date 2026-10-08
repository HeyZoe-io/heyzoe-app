import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";
import {
  canViewManualBulkJobs,
  cancelManualBulkJob,
  loadManualBulkJobsOverview,
} from "@/lib/manual-bulk/jobs-overview";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

async function requireJobsAccess(slug: string) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(admin, { id: user.user.id, email: user.user.email }, slug);
  if (!access.ok) {
    return { ok: false as const, response: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  const allowed = canViewManualBulkJobs({
    isPlatformAdmin: isAdminAllowedEmail(user.user.email ?? ""),
    businessOwnerUserId: access.business.user_id,
    userId: user.user.id,
  });
  if (!allowed) {
    return { ok: false as const, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, admin, business: access.business, userId: user.user.id };
}

/**
 * GET /api/[slug]/bulk-send/jobs?offset=N — manual bulk jobs, newest first, with counts.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireJobsAccess(slug);
  if (!gate.ok) return gate.response;
  const offset = Math.max(0, Math.trunc(Number(req.nextUrl.searchParams.get("offset") ?? 0)) || 0);
  try {
    const result = await loadManualBulkJobsOverview(gate.admin, { businessId: gate.business.id, offset });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/bulk-send/jobs] list failed:", message, { slug: gate.business.slug });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/[slug]/bulk-send/jobs — { action: "cancel", job_id, confirmed: true }.
 * Cancels the job's pending rows only.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireJobsAccess(slug);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.action !== "cancel") return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  if (body.confirmed !== true) return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  const jobId = String(body.job_id ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "missing_job_id" }, { status: 400 });

  try {
    const result = await cancelManualBulkJob(gate.admin, {
      businessId: gate.business.id,
      jobId,
      canceledBy: gate.userId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/bulk-send/jobs] cancel failed:", message, { slug: gate.business.slug, job_id: jobId });
    const status = message === "job_not_found" ? 404 : message === "missing_job_id" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
