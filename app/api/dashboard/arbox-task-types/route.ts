import { NextRequest, NextResponse } from "next/server";
import { arboxPublicFetch, parseArboxTaskTypes } from "@/lib/crm/adapters/arbox";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
} from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/** GET ?slug= — lists Arbox task types using stored crm_api_key (dashboard settings). */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = normDashboardSlug(req.nextUrl.searchParams.get("slug") ?? "");
  if (!slug) return NextResponse.json({ error: "slug_required" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id, {
    adminAll: isAdminAllowedEmail(user.email ?? ""),
  });
  const biz = pickBusinessBySlug(accessible, slug);
  if (!biz) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const crmType = String((biz as { crm_type?: unknown }).crm_type ?? "")
    .trim()
    .toLowerCase();
  if (crmType !== "arbox") {
    return NextResponse.json({ error: "crm_not_arbox" }, { status: 400 });
  }

  const apiKey = String((biz as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
  const boxId = String((biz as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
  if (!apiKey || !boxId) {
    return NextResponse.json({ error: "missing_crm_credentials" }, { status: 400 });
  }

  const qs = new URLSearchParams({ limit: "500" });
  const locationId = Number.parseInt(boxId, 10);
  if (Number.isFinite(locationId) && locationId > 0) {
    qs.set("location_id", String(locationId));
  }

  const res = await arboxPublicFetch(`/v3/tasks/types?${qs.toString()}`, { apiKey, method: "GET" });
  if (!res.ok) {
    console.error("[api/dashboard/arbox-task-types] Arbox fetch failed", {
      slug,
      status: res.status,
      body: res.rawText.slice(0, 500),
    });
    return NextResponse.json(
      {
        error: "arbox_task_types_fetch_failed",
        status: res.status,
      },
      { status: 502 }
    );
  }

  const types = parseArboxTaskTypes(res.json);
  return NextResponse.json({ types });
}
