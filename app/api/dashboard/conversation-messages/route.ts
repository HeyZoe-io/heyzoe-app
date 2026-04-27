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

export const runtime = "nodejs";

type SessionMessage = {
  role: string;
  content: string;
  created_at: string;
  error_code?: string | null;
};

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = normDashboardSlug(req.nextUrl.searchParams.get("slug") ?? "");
  const sessionId = String(req.nextUrl.searchParams.get("session_id") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  if (!sessionId) return NextResponse.json({ error: "missing_session_id" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id, { adminAll: isAdminAllowedEmail(user.email ?? "") });
  const business = pickBusinessBySlug(accessible, slug) as DashboardBizRow | null;
  if (!business) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: messages } = await admin
    .from("messages")
    .select("role, content, created_at, error_code")
    .eq("business_slug", slug)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const out: SessionMessage[] = (messages ?? []).map((m: any) => ({
    role: String(m.role ?? ""),
    content: String(m.content ?? ""),
    created_at: String(m.created_at ?? ""),
    error_code: (m.error_code as string | null) ?? null,
  }));

  return NextResponse.json({ messages: out });
}

