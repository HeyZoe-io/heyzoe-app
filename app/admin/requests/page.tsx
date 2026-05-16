import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { AdminNav } from "@/app/admin/AdminNav";

type SupportThreadRow = {
  id: number;
  created_at: string;
  updated_at: string;
  business_slug: string;
  user_id: string;
  status: string;
  callback_phone: string | null;
  callback_requested_at: string | null;
  last_message_at: string;
};

type SupportMessageRow = {
  request_id: number;
  role: string;
  content: string;
  created_at: string;
};

export default async function AdminRequestsPage() {
  // Middleware already gates /admin/* by allowed email,
  // but keep a session check to avoid confusing blank pages in dev.
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const { data: threads } = await admin
    .from("support_requests")
    .select(
      "id, created_at, updated_at, business_slug, user_id, status, callback_phone, callback_requested_at, last_message_at"
    )
    .order("last_message_at", { ascending: false })
    .limit(200);

  const threadIds = (threads ?? []).map((t: any) => Number(t.id)).filter((n) => Number.isFinite(n));
  const { data: lastMsgs } = threadIds.length
    ? await admin
        .from("support_request_messages")
        .select("request_id, role, content, created_at")
        .in("request_id", threadIds)
        .order("created_at", { ascending: false })
        .limit(400)
    : { data: [] as any[] };

  const lastByThread = new Map<number, SupportMessageRow>();
  for (const m of lastMsgs ?? []) {
    const rid = Number((m as any).request_id);
    if (!Number.isFinite(rid)) continue;
    if (!lastByThread.has(rid)) {
      lastByThread.set(rid, {
        request_id: rid,
        role: String((m as any).role ?? ""),
        content: String((m as any).content ?? ""),
        created_at: String((m as any).created_at ?? ""),
      });
    }
  }

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: "#f5f3ff",
        fontFamily: "Fredoka, Heebo, system-ui, sans-serif",
        padding: "28px 18px 48px",
        color: "#1a0a3c",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }} className="space-y-4">
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            alignItems: "end",
            justifyContent: "space-between",
          }}
        >
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, color: "#1a0a3c" }}>פניות מבעלי עסקים</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>
              צ׳אט עזרה מהדשבורד + בקשות לחזרה טלפונית (מודגשות)
            </p>
          </div>
          <AdminNav active="requests" />
        </header>

        <div className="grid gap-3">
          {(threads as any as SupportThreadRow[] | null)?.length ? (
            (threads as any as SupportThreadRow[]).map((t) => {
              const last = lastByThread.get(Number(t.id));
              const callback = t.callback_phone?.trim();
              const callbackAt = t.callback_requested_at ? new Date(t.callback_requested_at).toLocaleString() : "";
              return (
                <div
                  key={t.id}
                  className={`rounded-2xl border bg-white p-4 text-right ${
                    callback ? "border-amber-300 shadow-[0_10px_30px_rgba(245,158,11,0.18)]" : "border-zinc-200"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-normal text-zinc-900">
                        עסק: <span className="font-mono">{t.business_slug}</span>
                      </p>
                      <p className="text-xs text-zinc-500">
                        Thread #{t.id} · User: <span className="font-mono">{t.user_id}</span>
                      </p>
                    </div>
                    <div className="text-left">
                      {callback ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                          <p className="text-xs font-normal text-amber-900">בקשת חזרה טלפונית</p>
                          <p className="text-sm font-mono text-amber-900">{callback}</p>
                          <p className="text-[11px] text-amber-700">{callbackAt}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          עודכן: {new Date(t.last_message_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>

                  {last?.content ? (
                    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                      <p className="text-[11px] text-zinc-500">
                        הודעה אחרונה ({last.role}) · {new Date(last.created_at).toLocaleString()}
                      </p>
                      <p className="text-sm text-zinc-800 mt-1 line-clamp-3 whitespace-pre-wrap">
                        {last.content}
                      </p>
                    </div>
                  ) : null}

                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-[#7133da] font-normal">
                      הצג התכתבות
                    </summary>
                    <AdminThreadMessages threadId={t.id} />
                  </details>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-600">
              אין פניות עדיין.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

async function AdminThreadMessages({ threadId }: { threadId: number }) {
  const admin = createSupabaseAdminClient();
  const { data: msgs } = await admin
    .from("support_request_messages")
    .select("role, content, created_at")
    .eq("request_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200);

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-3 space-y-2">
      {(msgs ?? []).map((m: any, idx: number) => (
        <div key={idx} className="flex justify-end">
          <div
            className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm border whitespace-pre-wrap ${
              m.role === "owner"
                ? "bg-white border-zinc-200 text-zinc-900"
                : m.role === "assistant"
                  ? "bg-[#f0eaff] border-[rgba(113,51,218,0.2)] text-[#2d1a6e]"
                  : "bg-amber-50 border-amber-200 text-amber-900"
            }`}
          >
            <p className="text-[10px] opacity-70 mb-1">
              {m.role} · {new Date(String(m.created_at ?? "")).toLocaleString()}
            </p>
            {String(m.content ?? "")}
          </div>
        </div>
      ))}
    </div>
  );
}

