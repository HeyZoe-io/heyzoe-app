import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import {
  buildAiUsageBusinessReports,
  defaultAiUsageWindowFromIso,
  type AiUsageGranularity,
} from "@/lib/ai-usage-aggregate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

function parseOptionalIso(raw: string | null): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/**
 * GET /api/admin/ai-usage
 * Query: business_id?, from?, to? (to exclusive), granularity=month|total (default month).
 * Default window: trailing 12 Israel calendar months when from/to omitted.
 * Admin page UI deferred — SQL/endpoint only for now.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const businessIdRaw = sp.get("business_id");
  let businessId: number | null = null;
  if (businessIdRaw != null && String(businessIdRaw).trim() !== "") {
    const n = Number(businessIdRaw);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "invalid_business_id" }, { status: 400 });
    }
    businessId = n;
  }

  const fromParam = parseOptionalIso(sp.get("from"));
  const toParam = parseOptionalIso(sp.get("to"));
  if (sp.get("from") && !fromParam) {
    return NextResponse.json({ error: "invalid_from" }, { status: 400 });
  }
  if (sp.get("to") && !toParam) {
    return NextResponse.json({ error: "invalid_to" }, { status: 400 });
  }

  const granRaw = String(sp.get("granularity") ?? "month").trim().toLowerCase();
  const granularity: AiUsageGranularity = granRaw === "total" ? "total" : "month";
  if (granRaw && granRaw !== "month" && granRaw !== "total") {
    return NextResponse.json({ error: "invalid_granularity" }, { status: 400 });
  }

  const hasWindow = Boolean(fromParam || toParam);
  const fromIso = hasWindow ? fromParam : defaultAiUsageWindowFromIso();
  const toIso = hasWindow ? toParam : null;

  try {
    const businesses = await buildAiUsageBusinessReports({
      businessId,
      fromIso,
      toIso,
      granularity,
    });
    return NextResponse.json({
      granularity,
      from: fromIso,
      to: toIso,
      businesses,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/ai-usage] failed:", msg);
    return NextResponse.json({ error: "query_failed", message: msg }, { status: 500 });
  }
}
