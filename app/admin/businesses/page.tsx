import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { AdminNav } from "@/app/admin/AdminNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  searchParams:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

type BusinessesSubTab = "businesses" | "cancellations" | "requests";

type BizRow = {
  id: number;
  slug: string;
  name: string | null;
  plan: string | null;
  is_active: boolean | null;
  whatsapp_number: string | null;
};

type ChannelRow = {
  business_slug: string | null;
  phone_display: string | null;
  is_active: boolean | null;
  provisioning_status: string | null;
};

type SurveyRow = {
  id: string;
  created_at: string;
  reason: string;
  reason_detail: string | null;
  business_slug: string | null;
  business_id: number | null;
};

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

function firstSearchParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x.trim() : "";
}

function parseTab(raw: string): BusinessesSubTab {
  if (raw === "cancellations") return "cancellations";
  if (raw === "requests") return "requests";
  return "businesses";
}

function planLabel(plan: string | null): string {
  const p = String(plan ?? "").trim().toLowerCase();
  if (p === "premium" || p === "pro") return "premium";
  return "basic";
}

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function tabHref(tab: BusinessesSubTab) {
  return tab === "businesses" ? "/admin/businesses" : `/admin/businesses?tab=${tab}`;
}

function SubTabs({ active }: { active: BusinessesSubTab }) {
  const tabs: { id: BusinessesSubTab; label: string; hint: string }[] = [
    { id: "businesses", label: "עסקים", hint: "סטטוס, חבילה ומספרים" },
    { id: "cancellations", label: "ביטולים", hint: "שאלוני ביטול" },
    { id: "requests", label: "פניות מבעלי עסקים", hint: "צ׳אט עזרה וחזרה טלפונית" },
  ];
  return (
    <nav className="mt-5 flex overflow-x-auto pb-1" aria-label="טאבי עסקים">
      <div className="inline-flex min-w-max items-center gap-1 rounded-2xl bg-zinc-100/80 p-1">
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={tabHref(tab.id)}
              prefetch
              className={[
                "rounded-xl px-4 py-2 text-right transition-colors",
                isActive ? "bg-white text-[#7133da] shadow-sm ring-1 ring-[#7133da]/15" : "text-zinc-600 hover:bg-white/70",
              ].join(" ")}
            >
              <span className="block text-sm font-medium">{tab.label}</span>
              <span className="block text-[11px] text-zinc-400">{tab.hint}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default async function AdminBusinessesPage({ searchParams }: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const sp = (await Promise.resolve(searchParams)) ?? {};
  const tab = parseTab(firstSearchParam(sp.tab));
  const admin = createSupabaseAdminClient();

  const [{ data: businessesRaw }, { data: channelsRaw }, { data: surveysRaw }, { data: threadsRaw }] = await Promise.all([
    admin
      .from("businesses")
      .select("id, slug, name, plan, is_active, whatsapp_number")
      .order("created_at", { ascending: false })
      .limit(2000),
    admin
      .from("whatsapp_channels")
      .select("business_slug, phone_display, is_active, provisioning_status")
      .limit(5000),
    admin
      .from("cancellation_surveys")
      .select("id, created_at, reason, reason_detail, business_slug, business_id")
      .order("created_at", { ascending: false })
      .limit(500),
    admin
      .from("support_requests")
      .select("id, created_at, updated_at, business_slug, user_id, status, callback_phone, callback_requested_at, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(200),
  ]);

  const businesses = (businessesRaw ?? []) as unknown as BizRow[];
  const channels = (channelsRaw ?? []) as unknown as ChannelRow[];
  const surveys = ((surveysRaw ?? []) as unknown as SurveyRow[]).filter(Boolean);
  const threads = ((threadsRaw ?? []) as unknown as SupportThreadRow[]).filter(Boolean);

  const channelBySlug = new Map<string, ChannelRow>();
  for (const ch of channels) {
    const slug = String(ch.business_slug ?? "").trim().toLowerCase();
    const phone = String(ch.phone_display ?? "").trim();
    if (!slug || !phone) continue;
    const existing = channelBySlug.get(slug);
    if (!existing || Boolean(ch.is_active) || !existing.phone_display) {
      channelBySlug.set(slug, ch);
    }
  }

  const bizIds = [
    ...new Set(surveys.map((s) => s.business_id).filter((x): x is number => typeof x === "number" && Number.isFinite(x))),
  ];
  const nameById = new Map<number, string>();
  if (bizIds.length) {
    const { data: bizRows } = await admin.from("businesses").select("id, name").in("id", bizIds);
    for (const b of bizRows ?? []) {
      nameById.set(Number((b as any).id), String((b as any).name ?? "").trim());
    }
  }

  const threadIds = threads.map((t) => Number(t.id)).filter((n) => Number.isFinite(n));
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
    if (!Number.isFinite(rid) || lastByThread.has(rid)) continue;
    lastByThread.set(rid, {
      request_id: rid,
      role: String((m as any).role ?? ""),
      content: String((m as any).content ?? ""),
      created_at: String((m as any).created_at ?? ""),
    });
  }

  const totalCancellations = surveys.length;
  const countByReason = new Map<string, number>();
  for (const s of surveys) {
    const r = String(s.reason ?? "").trim() || "לא ידוע";
    countByReason.set(r, (countByReason.get(r) ?? 0) + 1);
  }
  const cancellationAggregates = [...countByReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({
      reason,
      count,
      pct: totalCancellations > 0 ? Math.round((count / totalCancellations) * 1000) / 10 : 0,
    }));

  return (
    <main dir="rtl" className="min-h-screen bg-zinc-50 px-4 py-7 text-[#1a0a3c] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="text-right">
            <p className="mb-1 text-xs font-semibold text-[#7133da]">HeyZoe Admin</p>
            <h1 className="m-0 text-3xl font-bold tracking-[-0.03em]">עסקים</h1>
            <p className="mt-1.5 text-sm text-zinc-500">כל מה שקשור לעסקים, ביטולים ופניות במקום אחד.</p>
          </div>
          <AdminNav active="businesses" />
        </header>

        <SubTabs active={tab} />

        <section className="mt-4 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_12px_34px_rgba(24,24,27,0.06)]">
          {tab === "businesses" ? (
            <BusinessesTable businesses={businesses} channelBySlug={channelBySlug} />
          ) : tab === "cancellations" ? (
            <CancellationsView
              surveys={surveys}
              nameById={nameById}
              total={totalCancellations}
              aggregates={cancellationAggregates}
            />
          ) : (
            <RequestsView threads={threads} lastByThread={lastByThread} />
          )}
        </section>
      </div>
    </main>
  );
}

function BusinessesTable({
  businesses,
  channelBySlug,
}: {
  businesses: BizRow[];
  channelBySlug: Map<string, ChannelRow>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse">
        <thead>
          <tr className="text-right text-xs text-zinc-500">
            <th className="border-b border-zinc-100 px-2 py-3">עסק</th>
            <th className="border-b border-zinc-100 px-2 py-3">slug</th>
            <th className="border-b border-zinc-100 px-2 py-3">מספר ווטסאפ</th>
            <th className="border-b border-zinc-100 px-2 py-3">חבילה</th>
            <th className="border-b border-zinc-100 px-2 py-3">סטטוס</th>
            <th className="border-b border-zinc-100 px-2 py-3">לינקים</th>
          </tr>
        </thead>
        <tbody>
          {businesses.map((b) => {
            const slug = String(b.slug ?? "").trim().toLowerCase();
            const active = Boolean(b.is_active);
            const channel = channelBySlug.get(slug);
            const whatsappNumber = String(b.whatsapp_number ?? channel?.phone_display ?? "").trim();
            const channelStatus = String(channel?.provisioning_status ?? "").trim();
            return (
              <tr key={String(b.id)} className="border-b border-zinc-100 text-sm">
                <td className="px-2 py-3 font-medium text-zinc-900">{b.name || slug}</td>
                <td className="px-2 py-3 font-mono text-xs text-zinc-500">{slug}</td>
                <td className={`px-2 py-3 text-xs ${whatsappNumber ? "text-zinc-900" : "text-zinc-400"}`}>
                  {whatsappNumber || "—"}
                  {channelStatus ? <span className="ms-2 text-[11px] text-zinc-400">{channelStatus}</span> : null}
                </td>
                <td className="px-2 py-3">
                  <span className="inline-flex rounded-full border border-[#7133da]/15 bg-[#7133da]/10 px-3 py-1 text-xs text-[#7133da]">
                    {planLabel(b.plan)}
                  </span>
                </td>
                <td className="px-2 py-3">
                  <span
                    className={[
                      "inline-flex rounded-full border px-3 py-1 text-xs",
                      active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800",
                    ].join(" ")}
                  >
                    {active ? "פעיל" : "לא פעיל"}
                  </span>
                </td>
                <td className="px-2 py-3 text-sm">
                  <div className="flex flex-wrap gap-3">
                    <a href={`/${encodeURIComponent(slug)}/analytics`} className="text-[#7133da] underline underline-offset-4">
                      אנליטיקס
                    </a>
                    <a href={`/${encodeURIComponent(slug)}/conversations`} className="text-[#7133da] underline underline-offset-4">
                      שיחות
                    </a>
                    <a href={`/${encodeURIComponent(slug)}/settings`} className="text-[#7133da] underline underline-offset-4">
                      הגדרות
                    </a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CancellationsView({
  surveys,
  nameById,
  total,
  aggregates,
}: {
  surveys: SurveyRow[];
  nameById: Map<number, string>;
  total: number;
  aggregates: { reason: string; count: number; pct: number }[];
}) {
  return (
    <div className="space-y-6 text-right">
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-zinc-900">סיכום לפי סיבה</h2>
        {total === 0 ? (
          <p className="text-sm text-zinc-500">עדיין אין תשובות שאלון ביטול.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {aggregates.map((row) => (
              <div key={row.reason} className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4">
                <div className="text-sm text-zinc-500">{row.reason}</div>
                <div className="mt-2 text-2xl font-bold text-[#7133da]">{row.count}</div>
                <div className="mt-1 text-sm text-zinc-700">{row.pct}% מהביטולים</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-zinc-900">כל הביטולים</h2>
        <div className="overflow-x-auto rounded-2xl border border-zinc-200">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="text-right text-xs text-zinc-500">
                <th className="border-b border-zinc-100 px-4 py-3">שם עסק</th>
                <th className="border-b border-zinc-100 px-4 py-3">תאריך ביטול</th>
                <th className="border-b border-zinc-100 px-4 py-3">סיבה</th>
                <th className="border-b border-zinc-100 px-4 py-3">פירוט</th>
              </tr>
            </thead>
            <tbody>
              {surveys.map((s) => {
                const bid = typeof s.business_id === "number" ? s.business_id : null;
                const bizName = (bid != null ? nameById.get(bid) : "") || String(s.business_slug ?? "").trim() || "—";
                const detail = String(s.reason_detail ?? "").trim();
                return (
                  <tr key={s.id} className="border-b border-zinc-100 text-sm">
                    <td className="px-4 py-3 align-top font-medium">{bizName}</td>
                    <td className="whitespace-nowrap px-4 py-3 align-top text-zinc-600">{formatDateTime(s.created_at)}</td>
                    <td className="max-w-[220px] px-4 py-3 align-top">{String(s.reason ?? "—")}</td>
                    <td className="max-w-[320px] px-4 py-3 align-top text-zinc-500">{detail || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RequestsView({
  threads,
  lastByThread,
}: {
  threads: SupportThreadRow[];
  lastByThread: Map<number, SupportMessageRow>;
}) {
  if (!threads.length) {
    return <div className="p-8 text-center text-sm text-zinc-500">אין פניות עדיין.</div>;
  }

  return (
    <div className="grid gap-3">
      {threads.map((t) => {
        const last = lastByThread.get(Number(t.id));
        const callback = t.callback_phone?.trim();
        const callbackAt = t.callback_requested_at ? new Date(t.callback_requested_at).toLocaleString() : "";
        return (
          <div
            key={t.id}
            className={`rounded-2xl border bg-white p-4 text-right ${
              callback ? "border-amber-300 shadow-[0_10px_30px_rgba(245,158,11,0.12)]" : "border-zinc-200"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  עסק: <span className="font-mono">{t.business_slug}</span>
                </p>
                <p className="text-xs text-zinc-500">
                  Thread #{t.id} · User: <span className="font-mono">{t.user_id}</span>
                </p>
              </div>
              <div className="text-left">
                {callback ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-medium text-amber-900">בקשת חזרה טלפונית</p>
                    <p className="text-sm font-mono text-amber-900">{callback}</p>
                    <p className="text-[11px] text-amber-700">{callbackAt}</p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">עודכן: {new Date(t.last_message_at).toLocaleString()}</p>
                )}
              </div>
            </div>

            {last?.content ? (
              <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="text-[11px] text-zinc-500">
                  הודעה אחרונה ({last.role}) · {new Date(last.created_at).toLocaleString()}
                </p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-zinc-800">{last.content}</p>
              </div>
            ) : null}

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-[#7133da]">הצג התכתבות</summary>
              <AdminThreadMessages threadId={t.id} />
            </details>
          </div>
        );
      })}
    </div>
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
    <div className="mt-3 space-y-2 rounded-2xl border border-zinc-200 bg-white p-3">
      {(msgs ?? []).map((m: any, idx: number) => (
        <div key={idx} className="flex justify-end">
          <div
            className={`max-w-[92%] rounded-2xl border px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "owner"
                ? "border-zinc-200 bg-white text-zinc-900"
                : m.role === "assistant"
                  ? "border-[#7133da]/20 bg-[#f0eaff] text-[#2d1a6e]"
                  : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <p className="mb-1 text-[10px] opacity-70">
              {m.role} · {new Date(String(m.created_at ?? "")).toLocaleString()}
            </p>
            {String(m.content ?? "")}
          </div>
        </div>
      ))}
    </div>
  );
}
