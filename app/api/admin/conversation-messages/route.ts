import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveAdminAllowedEmail } from "@/lib/server-env";

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
  return data.user.email.toLowerCase() === resolveAdminAllowedEmail();
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = String(req.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  const sessionId = String(req.nextUrl.searchParams.get("session_id") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  if (!sessionId) return NextResponse.json({ error: "missing_session_id" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: messages } = await admin
    .from("messages")
    .select("role, content, created_at, error_code")
    .eq("business_slug", slug)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(2000);

  const out: SessionMessage[] = (messages ?? []).map((m: any) => ({
    role: String(m.role ?? ""),
    content: String(m.content ?? ""),
    created_at: String(m.created_at ?? ""),
    error_code: (m.error_code as string | null) ?? null,
  }));
  return NextResponse.json({ messages: out });
}

