import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { isBusinessSubscriptionActive } from "@/lib/notifications/business-notification-eligibility";
import {
  clampManualBulkWeeks,
  isManualBulkAudienceType,
} from "@/lib/manual-bulk/constants";
import { previewManualBulkSend } from "@/lib/manual-bulk/preview";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(admin, { id: user.user.id, email: user.user.email }, slug);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (!isBusinessSubscriptionActive(access.business)) {
    return NextResponse.json({ error: "subscription_inactive" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const audienceType = String(body.audience_type ?? "");
  if (!isManualBulkAudienceType(audienceType)) {
    return NextResponse.json({ error: "invalid_audience_type" }, { status: 400 });
  }
  const templateName = String(body.template_name ?? "").trim();
  if (!templateName) {
    return NextResponse.json({ error: "missing_template_name" }, { status: 400 });
  }

  const { data: biz } = await admin
    .from("businesses")
    .select("name")
    .eq("id", access.business.id)
    .maybeSingle();

  try {
    const preview = await previewManualBulkSend({
      admin,
      businessId: access.business.id,
      businessSlug: access.business.slug,
      businessName: String((biz as { name?: unknown } | null)?.name ?? ""),
      audienceType,
      templateName,
      weeks: clampManualBulkWeeks(body.weeks),
      membershipTypeNames: Array.isArray(body.membership_type_names)
        ? body.membership_type_names.map((n) => String(n ?? "").trim()).filter(Boolean)
        : [],
      includePunchCards: body.include_punch_cards === true,
      scheduledAtRaw: body.scheduled_at,
    });
    return NextResponse.json({ ok: true, ...preview });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/bulk-send/preview] failed:", message, { slug: access.business.slug });
    const status =
      message === "audience_membership_requires_arbox" ||
      message === "template_not_approved_marketing" ||
      message === "schedule_in_past" ||
      message === "invalid_schedule_time"
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
