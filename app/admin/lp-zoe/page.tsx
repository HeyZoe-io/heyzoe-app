import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type LpZoeTurn = {
  id: number;
  created_at: string;
  session_id: string;
  user_message: string;
  assistant_message: string;
};

function groupBySession(turns: LpZoeTurn[]): { sessionId: string; turns: LpZoeTurn[]; lastAt: string }[] {
  const map = new Map<string, LpZoeTurn[]>();
  for (const t of turns) {
    const sid = String(t.session_id ?? "unknown");
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid)!.push(t);
  }
  const sessions: { sessionId: string; turns: LpZoeTurn[]; lastAt: string }[] = [];
  for (const [sessionId, list] of map) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const last = sorted[sorted.length - 1]!;
    sessions.push({ sessionId, turns: sorted, lastAt: last.created_at });
  }
  sessions.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return sessions;
}

export default async function AdminLpZoeLandingPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const { data: rawTurns, error } = await admin
    .from("lp_zoe_landing_chat_turns")
    .select("id, created_at, session_id, user_message, assistant_message")
    .order("created_at", { ascending: false })
    .limit(500);

  const turns = (rawTurns ?? []) as LpZoeTurn[];
  const sessions = groupBySession(turns);

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-8" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-right">
            <h1 className="text-2xl font-normal text-zinc-900">שיחות זואי - דף נחיתה</h1>
            <p className="text-sm text-zinc-500">
              סשנים מדף הלידים (lp-leads) · עד 500 תגובות אחרונות · מקובצים לפי session
            </p>
            {error ? (
              <p className="text-sm text-red-600 mt-1">שגיאת טעינה: {error.message}</p>
            ) : null}
          </div>
          <a
            href="/admin/dashboard"
            className="text-sm text-zinc-700 underline underline-offset-4 shrink-0"
          >
            חזרה לדשבורד
          </a>
        </div>

        <div className="space-y-4">
          {sessions.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-600">
              {error ? "לא נטענו שיחות." : "אין שיחות מתועדות עדיין (או שהטבלה עדיין לא נוצרה ב-Supabase)."}
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.sessionId}
                className="rounded-2xl border border-zinc-200 bg-white p-4 text-right"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-2 mb-3">
                  <p className="text-xs text-zinc-500">
                    עדכון אחרון: {new Date(s.lastAt).toLocaleString("he-IL")}
                  </p>
                  <p className="text-sm font-mono text-zinc-800 break-all">
                    session: {s.sessionId}
                  </p>
                </div>
                <div className="space-y-3">
                  {s.turns.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 space-y-2"
                    >
                      <p className="text-[11px] text-zinc-500">
                        {new Date(t.created_at).toLocaleString("he-IL")} · #{t.id}
                      </p>
                      <div>
                        <p className="text-[11px] font-normal text-zinc-600 mb-0.5">מבקר</p>
                        <p className="text-sm text-zinc-900 whitespace-pre-wrap">{t.user_message}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-normal text-[#7133da] mb-0.5">זואי</p>
                        <p className="text-sm text-zinc-800 whitespace-pre-wrap">
                          {t.assistant_message}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
