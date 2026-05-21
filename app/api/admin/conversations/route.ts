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
      const { data: bizRows } = await admin.from("businesses").select("slug, name").limit(2000);
      const businesses = (bizRows ?? []).map((b) => ({
        slug: String((b as { slug?: string }).slug ?? "").trim().toLowerCase(),
        name: ((b as { name?: string | null }).name ?? null) as string | null,
      })).filter((b) => b.slug);
      const sessions = await loadAllZoeAdminConversationSessions(admin, businesses);
      return NextResponse.json({ sessions, slug: ZOE_ADMIN_ALL_CONVERSATIONS_SLUG });
    }

    if (isMarketingConversationsSlug(slug)) {
      const sessions = await loadMarketingConversationSessions();
      return NextResponse.json({ sessions });
    }

    const sessions = await loadBusinessConversationSessions(admin, slug);
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "load_failed" },
      { status: 500 }
    );
  }
}
