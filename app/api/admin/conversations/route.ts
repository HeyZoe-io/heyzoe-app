import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { loadBusinessConversationSessions } from "@/lib/conversations-sessions";
import { isMarketingConversationsSlug, loadMarketingConversationSessions } from "@/lib/marketing-whatsapp";
import {
  isZoeAdminAllConversationsSlug,
  loadAllZoeAdminConversationSessions,
  ZOE_ADMIN_ALL_CONVERSATIONS_SLUG,
} from "@/lib/zoe-admin-conversations";
import { markSessionsWithFailedDelivery } from "@/lib/wa-message-delivery";

export const runtime = "nodejs";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = String(req.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();

    if (isZoeAdminAllConversationsSlug(slug)) {
      const { data: bizRows } = await admin.from("businesses").select("id, slug, name").limit(2000);
      const businesses = (bizRows ?? [])
        .map((b) => ({
          id: Number((b as { id?: unknown }).id),
          slug: String((b as { slug?: string }).slug ?? "").trim().toLowerCase(),
          name: ((b as { name?: string | null }).name ?? null) as string | null,
        }))
        .filter((b) => b.slug);
      const loaded = await loadAllZoeAdminConversationSessions(
        admin,
        businesses.map(({ slug: s, name }) => ({ slug: s, name }))
      );
      const sessions = await markSessionsWithFailedDelivery(admin, loaded, {
        businessIdBySlug: new Map(businesses.map((b) => [b.slug, b.id])),
      });
      return NextResponse.json({ sessions, slug: ZOE_ADMIN_ALL_CONVERSATIONS_SLUG });
    }

    if (isMarketingConversationsSlug(slug)) {
      const sessions = await loadMarketingConversationSessions();
      return NextResponse.json({ sessions });
    }

    const loaded = await loadBusinessConversationSessions(admin, slug);
    const { data: biz } = await admin.from("businesses").select("id").eq("slug", slug).maybeSingle();
    const businessId = Number((biz as { id?: unknown } | null)?.id);
    const sessions =
      Number.isFinite(businessId) && businessId > 0
        ? await markSessionsWithFailedDelivery(admin, loaded, { businessId })
        : loaded;
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "load_failed" },
      { status: 500 }
    );
  }
}
