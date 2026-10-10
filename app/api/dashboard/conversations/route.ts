import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
  type DashboardBizRow,
} from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { loadBusinessConversationSessions } from "@/lib/conversations-sessions";
import { markSessionsWithFailedDelivery } from "@/lib/wa-message-delivery";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = normDashboardSlug(req.nextUrl.searchParams.get("slug") ?? "");
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id, { adminAll: isAdminAllowedEmail(user.email ?? "") });
  const business = pickBusinessBySlug(accessible, slug) as DashboardBizRow | null;
  if (!business) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const loaded = await loadBusinessConversationSessions(admin, slug);
  const businessId = Number(business.id);
  const sessions =
    Number.isFinite(businessId) && businessId > 0
      ? await markSessionsWithFailedDelivery(admin, loaded, { businessId }, { unseenOnly: true })
      : loaded;
  return NextResponse.json({ sessions });
}
