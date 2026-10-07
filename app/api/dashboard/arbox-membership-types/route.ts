import { NextRequest, NextResponse } from "next/server";
import { fetchAllArboxMembershipTypes } from "@/lib/arbox-membership-types";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
} from "@/lib/dashboard-business-access";
import { getArboxApiKey } from "@/lib/business-secrets";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/** GET ?slug= — lists Arbox membership types using the stored Arbox API key. */
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

  const apiKey = getArboxApiKey(biz);
  const boxId = String((biz as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
  if (!apiKey || !boxId) {
    return NextResponse.json({ error: "missing_crm_credentials" }, { status: 400 });
  }

  const result = await fetchAllArboxMembershipTypes({
    apiKey,
    logLabel: "api/dashboard/arbox-membership-types",
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "arbox_membership_types_fetch_failed",
        status: result.status,
      },
      { status: 502 }
    );
  }

  const trialRaw = (biz as { arbox_trial_membership_type_ids?: unknown }).arbox_trial_membership_type_ids;
  const trialTypeIds = Array.isArray(trialRaw)
    ? [
        ...new Set(
          trialRaw
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0)
            .map((n) => Math.trunc(n))
        ),
      ]
    : [];

  return NextResponse.json({ types: result.types, trial_type_ids: trialTypeIds });
}
