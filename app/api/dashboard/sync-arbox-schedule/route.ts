import { NextRequest, NextResponse } from "next/server";
import {
  businessQualifiesForArboxScheduleSync,
  dismissArboxRemovedNotice,
  markArboxScheduleSyncedAt,
  persistManualArboxScheduleSync,
  pullArboxWeeklyTimetable,
} from "@/lib/arbox-schedule-sync";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
} from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

async function requireBusiness(slugRaw: string) {
  const user = await requireUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const slug = normDashboardSlug(slugRaw);
  if (!slug) return { error: NextResponse.json({ error: "slug_required" }, { status: 400 }) };
  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id, {
    adminAll: isAdminAllowedEmail(user.email ?? ""),
  });
  const biz = pickBusinessBySlug(accessible, slug);
  if (!biz) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { admin, biz, slug };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    slug?: unknown;
    action?: unknown;
    service_slug?: unknown;
  };
  const action = String(body.action ?? "sync").trim();
  const access = await requireBusiness(String(body.slug ?? ""));
  if ("error" in access) return access.error;
  const { admin, biz } = access;
  const businessId = Number(biz.id);

  if (action === "dismiss") {
    const serviceSlug = String(body.service_slug ?? "").trim();
    if (!serviceSlug) return NextResponse.json({ error: "service_slug_required" }, { status: 400 });
    const result = await dismissArboxRemovedNotice({
      admin,
      businessId,
      serviceSlug,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!businessQualifiesForArboxScheduleSync(biz)) {
    return NextResponse.json({ error: "crm_not_arbox" }, { status: 400 });
  }
  const apiKey = String((biz as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
  const locationId = String((biz as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
  if (!apiKey) return NextResponse.json({ error: "missing_crm_credentials" }, { status: 400 });

  const pulled = await pullArboxWeeklyTimetable({
    apiKey,
    locationId: locationId || undefined,
  });
  if (!pulled.ok) {
    console.error("[api/dashboard/sync-arbox-schedule] pull failed", {
      slug: access.slug,
      error: pulled.error,
      status: pulled.status ?? null,
    });
    return NextResponse.json({ error: pulled.error }, { status: 502 });
  }

  try {
    const persisted = await persistManualArboxScheduleSync({
      admin,
      businessId,
      classes: pulled.classes,
    });
    await markArboxScheduleSyncedAt(admin, businessId, new Date().toISOString());
    return NextResponse.json({
      ok: true,
      created: persisted.created,
      updated: persisted.updated,
      classes: pulled.classes.length,
      unmatched: pulled.unmatchedSessionNames,
      services: persisted.services.map((s) => ({
        name: s.name,
        description: s.description,
        service_slug: s.service_slug,
        location_mode: s.location_mode ?? "location",
        location_text: s.location_text ?? "",
        price_text: s.price_text ?? "",
        sort_order: s.sort_order ?? 0,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/dashboard/sync-arbox-schedule] persist failed", {
      slug: access.slug,
      error: message,
    });
    return NextResponse.json({ error: "persist_failed" }, { status: 500 });
  }
}
