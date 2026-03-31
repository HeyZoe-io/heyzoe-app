import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import ConversationsClient from "./client";
import DashboardSlugNav from "../Nav";

type Props = { params: Promise<{ slug: string }> };

export default async function ConversationsPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug")
    .eq("slug", slug)
    .eq("user_id", user.user.id)
    .maybeSingle();

  if (!biz) redirect("/dashboard/settings");

  const [{ data: messages }, { data: pausedRows }] = await Promise.all([
    admin
      .from("messages")
      .select("session_id, role, content, created_at")
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
      messages: { role: string; content: string; created_at: string }[];
    }
  >();

  (messages ?? []).forEach((m: any) => {
    const sid = (m.session_id || "anon") as string;
    const at = new Date(m.created_at as string);
    const existing = bySession.get(sid);
    const fromUser = m.role === "user";
    const msg = {
      role: m.role as string,
      content: (m.content as string) ?? "",
      created_at: m.created_at as string,
    };
    if (!existing) {
      bySession.set(sid, {
        lastAt: at,
        count: 1,
        lastFromUser: fromUser,
        messages: [msg],
      });
    } else {
      existing.lastAt = at;
      existing.count += 1;
      existing.lastFromUser = fromUser;
      existing.messages.push(msg);
    }
  });

  function extractPhone(sessionId: string): string {
    if (!sessionId.startsWith("wa_")) return "";
    const rest = sessionId.slice(3);
    const firstUnderscore = rest.indexOf("_");
    if (firstUnderscore < 0) return "";
    const fromNumber = rest.slice(firstUnderscore + 1);
    return fromNumber || "";
  }

  const sessions = [...bySession.entries()].map(([sid, data]) => {
    const isOpen =
      data.lastFromUser && Date.now() - data.lastAt.getTime() < 24 * 60 * 60 * 1000;
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

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <DashboardSlugNav slug={slug} />
        <h1 className="text-2xl font-semibold text-zinc-900 text-right">שיחות ל-{slug}</h1>
        <p className="text-sm text-zinc-600 text-right">
          רשימת השיחות, עצירת בוט ומענה ידני ללקוחות
        </p>

        <ConversationsClient slug={slug} initialSessions={sessions} />
      </div>
    </main>
  );
}

