import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";

type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
};

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

function extractPhone(sessionId: string): string {
  if (!sessionId.startsWith("wa_")) return "";
  const rest = sessionId.slice(3);
  const firstUnderscore = rest.indexOf("_");
  if (firstUnderscore < 0) return "";
  return rest.slice(firstUnderscore + 1) || "";
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = String(req.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const [{ data: messages }, { data: pausedRows }] = await Promise.all([
    admin
      .from("messages")
      .select("session_id, role, created_at")
      .eq("business_slug", slug)
      .order("created_at", { ascending: true })
      .limit(50_000),
    admin
      .from("paused_sessions")
      .select("session_id, paused_until")
      .eq("business_slug", slug)
      .gt("paused_until", new Date().toISOString()),
  ]);

  const pausedSet = new Set<string>((pausedRows ?? []).map((p: any) => String(p.session_id ?? "")));
  const bySession = new Map<string, { lastAt: Date; count: number; lastFromUser: boolean }>();
  (messages ?? []).forEach((m: any) => {
    const sid = String(m.session_id ?? "anon");
    const at = new Date(String(m.created_at ?? ""));
    const fromUser = String(m.role ?? "") === "user";
    const existing = bySession.get(sid);
    if (!existing) {
      bySession.set(sid, { lastAt: at, count: 1, lastFromUser: fromUser });
    } else {
      existing.lastAt = at;
      existing.count += 1;
      existing.lastFromUser = fromUser;
    }
  });

  const sessions: SessionSummary[] = [...bySession.entries()].map(([sid, data]) => {
    const isOpen = data.lastFromUser && Date.now() - data.lastAt.getTime() < 24 * 60 * 60 * 1000;
    return {
      session_id: sid,
      lastAt: data.lastAt.toISOString(),
      count: data.count,
      isOpen,
      isPaused: pausedSet.has(sid),
      phone: extractPhone(sid),
    };
  });

  sessions.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return NextResponse.json({ sessions });
}

