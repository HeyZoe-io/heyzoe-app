import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { isBusinessSubscriptionActive } from "@/lib/notifications/business-notification-eligibility";
import { clampManualBulkWeeks, isManualBulkAudienceType } from "@/lib/manual-bulk/constants";
import { loadApprovedMarketingTemplate } from "@/lib/manual-bulk/preview";
import {
  parseManualBulkTimeLocal,
  parseManualBulkWeekday,
  nextWeeklyRunAt,
} from "@/lib/manual-bulk/recurrence";
import {
  createManualBulkSchedule,
  listManualBulkSchedules,
  setManualBulkScheduleEnabled,
} from "@/lib/manual-bulk/schedules";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

async function requireSchedulesAccess(slug: string) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(admin, { id: user.user.id, email: user.user.email }, slug);
  if (!access.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: access.error }, { status: access.status }),
    };
  }
  if (!isBusinessSubscriptionActive(access.business)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "subscription_inactive" }, { status: 403 }),
    };
  }
  return { ok: true as const, admin, business: access.business, userId: user.user.id };
}

/**
 * GET /api/[slug]/bulk-send/schedules — list weekly M1 campaigns.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireSchedulesAccess(slug);
  if (!gate.ok) return gate.response;
  try {
    const schedules = await listManualBulkSchedules({
      admin: gate.admin,
      businessId: gate.business.id,
    });
    return NextResponse.json({ schedules });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/bulk-send/schedules] list failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/[slug]/bulk-send/schedules — create a weekly campaign.
 * Does not enqueue immediately; the scheduled-template-sends cron materializes each week.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireSchedulesAccess(slug);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.confirmed !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  const audienceType = String(body.audience_type ?? "");
  if (!isManualBulkAudienceType(audienceType)) {
    return NextResponse.json({ error: "invalid_audience_type" }, { status: 400 });
  }
  const templateName = String(body.template_name ?? "").trim();
  if (!templateName) {
    return NextResponse.json({ error: "missing_template_name" }, { status: 400 });
  }
  const weekday = parseManualBulkWeekday(body.weekday);
  if (weekday === "invalid") {
    return NextResponse.json({ error: "invalid_weekday" }, { status: 400 });
  }
  const timeLocal = parseManualBulkTimeLocal(body.time_local);
  if (timeLocal === "invalid") {
    return NextResponse.json({ error: "invalid_recurrence_time" }, { status: 400 });
  }

  const tpl = await loadApprovedMarketingTemplate({
    admin: gate.admin,
    businessId: gate.business.id,
    templateName,
  });
  if (!tpl) {
    return NextResponse.json({ error: "template_not_approved_marketing" }, { status: 400 });
  }

  try {
    const nextRunAt = nextWeeklyRunAt({
      weekday,
      timeLocal,
      from: new Date(),
    });
    const schedule = await createManualBulkSchedule({
      admin: gate.admin,
      businessId: gate.business.id,
      createdBy: gate.userId,
      audienceType,
      templateName: tpl.name,
      weekday,
      timeLocal,
      nextRunAt,
      weeks: clampManualBulkWeeks(body.weeks),
      membershipTypeNames: Array.isArray(body.membership_type_names)
        ? body.membership_type_names.map((n) => String(n ?? "").trim()).filter(Boolean)
        : [],
      includePunchCards: body.include_punch_cards === true,
    });
    return NextResponse.json({ ok: true, schedule });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/bulk-send/schedules] create failed:", message, {
      slug: gate.business.slug,
    });
    const status =
      message === "audience_membership_requires_arbox" ||
      message === "template_not_approved_marketing" ||
      message === "invalid_recurrence_time" ||
      message === "confirmation_required"
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * PATCH /api/[slug]/bulk-send/schedules — enable/disable.
 * Disable also cancels pending queue rows for this schedule's open jobs.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireSchedulesAccess(slug);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid_enabled" }, { status: 400 });
  }

  try {
    const result = await setManualBulkScheduleEnabled({
      admin: gate.admin,
      businessId: gate.business.id,
      scheduleId: id,
      enabled: body.enabled,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/bulk-send/schedules] patch failed:", message);
    const status = message === "schedule_not_found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
