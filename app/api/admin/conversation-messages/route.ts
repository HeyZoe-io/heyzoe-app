import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { resolveBusinessSlugVariants } from "@/lib/conversations-sessions";
import { isMarketingConversationsSlug, MARKETING_CONVERSATIONS_SLUG } from "@/lib/marketing-whatsapp";

export const runtime = "nodejs";

type SessionMessage = {
  role: string;
  content: string;
  created_at: string;
  error_code?: string | null;
};

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = String(req.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  const sessionId = String(req.nextUrl.searchParams.get("session_id") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  if (!sessionId) return NextResponse.json({ error: "missing_session_id" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const slugVariants = isMarketingConversationsSlug(slug)
    ? [MARKETING_CONVERSATIONS_SLUG]
    : await resolveBusinessSlugVariants(admin, slug);

  const { data: messages } = await admin
    .from("messages")
    .select("role, content, created_at, error_code")
    .in("business_slug", slugVariants.length ? slugVariants : [slug])
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(2000);

  const out: SessionMessage[] = (messages ?? []).map((m) => ({
    role: String((m as { role?: string }).role ?? ""),
    content: String((m as { content?: string }).content ?? ""),
    created_at: String((m as { created_at?: string }).created_at ?? ""),
    error_code: ((m as { error_code?: string | null }).error_code as string | null) ?? null,
  }));
  return NextResponse.json({ messages: out });
}
