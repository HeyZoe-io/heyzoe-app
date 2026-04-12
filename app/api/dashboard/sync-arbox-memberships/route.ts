import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { syncArboxMembershipsFromApi } from "@/lib/arbox-membership-api";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
} from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as { slug?: string; arbox_api_key?: string };
  const slug = normDashboardSlug(body.slug ?? "");
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id);
  const biz = pickBusinessBySlug(accessible, slug);
  if (!biz) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const socialRaw = biz.social_links;
  const social =
    socialRaw && typeof socialRaw === "object" && !Array.isArray(socialRaw)
      ? (socialRaw as Record<string, unknown>)
      : {};

  const bodyKey = String(body.arbox_api_key ?? "").trim();
  const apiKey = bodyKey || String(social.arbox_api_key ?? "").trim();
  const arboxLink = String(social.arbox_link ?? "").trim();

  const result = await syncArboxMembershipsFromApi(arboxLink, apiKey);
  if (!result.ok) {
    const status =
      result.code === "missing_api_key" || result.code === "missing_arbox_link" ? 400 : 502;
    return NextResponse.json(
      { error: result.code, message: result.message, last_status: result.last_status },
      { status }
    );
  }

  return NextResponse.json({
    membership_tiers: result.membership_tiers,
    punch_cards: result.punch_cards,
    source_url: result.source_url,
  });
}
