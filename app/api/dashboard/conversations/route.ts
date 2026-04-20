import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
  type DashboardBizRow,
} from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

type SessionMessage = {
  role: string;
  content: string;
  created_at: string;
  error_code?: string | null;
};

type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
  messages: SessionMessage[];
};

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

function extractPhone(sessionId: string): string {
  if (!sessionId.startsWith("wa_")) return "";
  const rest = sessionId.slice(3);
  const firstUnderscore = rest.indexOf("_");
  if (firstUnderscore < 0) return "";
  const fromNumber = rest.slice(firstUnderscore + 1);
  return fromNumber || "";
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = normDashboardSlug(req.nextUrl.searchParams.get("slug") ?? "");
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id);
  const business = pickBusinessBySlug(accessible, slug) as DashboardBizRow | null;
  if (!business) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [{ data: messages }, { data: pausedRows }] = await Promise.all([
    admin
      .from("messages")
      .select("session_id, role, content, created_at, error_code")
      .eq("business_slug", slug)
      .order("created_at", { ascending: true }),
    admin
      .from("paused_sessions")
      .select("session_id, paused_until")
      .eq("business_slug", slug)
      .gt("paused_until", new Date().toISOString()),
  ]);

  const pausedSet = new Set<string>((pausedRows ?? []).map((p: any) => p.session_id as string));

  const bySession = new Map<
    string,
    {
      lastAt: Date;
      count: number;
      lastFromUser: boolean;
      messages: SessionMessage[];
    }
  >();

  (messages ?? []).forEach((m: any) => {
    const sid = (m.session_id || "anon") as string;
    const at = new Date(m.created_at as string);
    const existing = bySession.get(sid);
    const fromUser = m.role === "user";
    const msg: SessionMessage = {
      role: m.role as string,
      content: (m.content as string) ?? "",
      created_at: m.created_at as string,
      error_code: (m.error_code as string | null) ?? null,
    };
    if (!existing) {
      bySession.set(sid, { lastAt: at, count: 1, lastFromUser: fromUser, messages: [msg] });
    } else {
      existing.lastAt = at;
      existing.count += 1;
      existing.lastFromUser = fromUser;
      existing.messages.push(msg);
    }
  });

  const sessions: SessionSummary[] = [...bySession.entries()].map(([sid, data]) => {
    const isOpen = data.lastFromUser && Date.now() - data.lastAt.getTime() < 24 * 60 * 60 * 1000;
    const isPaused = pausedSet.has(sid);
    return {
      session_id: sid,
      lastAt: data.lastAt.toISOString(),
      count: data.count,
      isOpen,
      isPaused,
      phone: extractPhone(sid),
      messages: data.messages,
    };
  });

  sessions.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return NextResponse.json({ sessions });
}

