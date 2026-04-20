import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
  type DashboardBizRow,
} from "@/lib/dashboard-business-access";
import ConversationsClient from "./client";

type Props = { params: Promise<{ slug: string }> };

type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
};

function extractPhone(sessionId: string): string {
  if (!sessionId.startsWith("wa_")) return "";
  const rest = sessionId.slice(3);
  const firstUnderscore = rest.indexOf("_");
  if (firstUnderscore < 0) return "";
  const fromNumber = rest.slice(firstUnderscore + 1);
  return fromNumber || "";
}

export default async function ConversationsPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  // Server-side initial load for fast first paint and resilience.
  let initialSessions: SessionSummary[] = [];
  try {
    const admin = createSupabaseAdminClient();
    const accessible = await loadAccessibleBusinesses(admin, user.user.id);
    const business = pickBusinessBySlug(accessible, normDashboardSlug(slug)) as DashboardBizRow | null;
    if (!business) redirect("/dashboard");

    const [{ data: messages }, { data: pausedRows }] = await Promise.all([
      admin
        .from("messages")
        .select("session_id, role, created_at")
        .eq("business_slug", normDashboardSlug(slug))
        .order("created_at", { ascending: true }),
      admin
        .from("paused_sessions")
        .select("session_id, paused_until")
        .eq("business_slug", normDashboardSlug(slug))
        .gt("paused_until", new Date().toISOString()),
    ]);

    const pausedSet = new Set<string>((pausedRows ?? []).map((p: any) => p.session_id as string));
    const bySession = new Map<
      string,
      {
        lastAt: Date;
        count: number;
        lastFromUser: boolean;
      }
    >();
    (messages ?? []).forEach((m: any) => {
      const sid = (m.session_id || "anon") as string;
      const at = new Date(m.created_at as string);
      const fromUser = m.role === "user";
      const existing = bySession.get(sid);
      if (!existing) {
        bySession.set(sid, { lastAt: at, count: 1, lastFromUser: fromUser });
      } else {
        existing.lastAt = at;
        existing.count += 1;
        existing.lastFromUser = fromUser;
      }
    });

    initialSessions = [...bySession.entries()].map(([sid, data]) => {
      const isOpen = data.lastFromUser && Date.now() - data.lastAt.getTime() < 24 * 60 * 60 * 1000;
      const isPaused = pausedSet.has(sid);
      return {
        session_id: sid,
        lastAt: data.lastAt.toISOString(),
        count: data.count,
        isOpen,
        isPaused,
        phone: extractPhone(sid),
      };
    });
    initialSessions.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  } catch {
    // If server-side preload fails, client-side query will still attempt to load.
    initialSessions = [];
  }

  return (
    <div className="space-y-6">
      <div className="hz-wave hz-wave-1">
        <h1 className="text-2xl font-semibold text-zinc-900 text-right">שיחות ל-{slug}</h1>
        <p className="text-sm text-zinc-600 text-right">
          רשימת השיחות, עצירת בוט ומענה ידני ללקוחות
        </p>
      </div>

      <div className="hz-wave hz-wave-2">
        <ConversationsClient slug={slug} initialSessions={initialSessions} />
      </div>
    </div>
  );
}

