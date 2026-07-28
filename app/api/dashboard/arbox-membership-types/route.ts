import { NextRequest, NextResponse } from "next/server";
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
} from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type ArboxMembershipTypesResponse = {
  statusCode?: number;
  data?: Array<Record<string, unknown>>;
};

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

function parseMembershipTypes(json: unknown): Array<{
  membership_type_id: number;
  membership_type_name: string;
}> {
  const rows = (json as ArboxMembershipTypesResponse | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: Array<{ membership_type_id: number; membership_type_name: string }> = [];
  for (const row of rows) {
    const id = Number(row.membership_type_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = String(row.membership_type_name ?? "").trim();
    out.push({ membership_type_id: id, membership_type_name: name || String(id) });
  }
  out.sort((a, b) => {
    const na = a.membership_type_name.localeCompare(b.membership_type_name, "he");
    if (na !== 0) return na;
    return a.membership_type_id - b.membership_type_id;
  });
  return out;
}

/** GET ?slug= — lists Arbox membership types using stored crm_api_key (dashboard settings). */
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

  const res = await arboxPublicFetch("/v3/membershipTypes", { apiKey, method: "GET" });
  if (!res.ok) {
    console.error("[api/dashboard/arbox-membership-types] Arbox fetch failed", {
      slug,
      status: res.status,
      body: res.rawText.slice(0, 500),
    });
    return NextResponse.json(
      {
        error: "arbox_membership_types_fetch_failed",
        status: res.status,
      },
      { status: 502 }
    );
  }

  const types = parseMembershipTypes(res.json);
  return NextResponse.json({ types });
}
