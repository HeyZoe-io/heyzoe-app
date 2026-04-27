"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type DashboardPayload = {
  range: { from: string; to: string };
  errors: { messagesError: string | null; conversionsError: string | null };
  kpis: { dailyActiveConversations: number; monthlyActiveConversations: number; annualActiveConversations: number };
  businessOverview: Array<{
    id: number;
    name: string;
    slug: string;
    plan: "basic" | "premium";
    active: boolean;
    paused: boolean;
    onboardingStep: number | null;
    conversationsTotal: number;
    conversationsWeek: number;
  }>;
  errorLogs: Array<{ at: string; slug: string; code: string; content: string }>;
  alerts: {
    unanswered: Array<{ slug: string; businessName: string; session_id: string; lastAt: string }>;
    repeatedFallback: Array<{ slug: string; businessName: string; session_id: string; count: number }>;
  };
};

type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
};

type SessionMessage = {
  role: string;
  content: string;
  created_at: string;
  error_code?: string | null;
};

export default function DashboardClient({ data }: { data: DashboardPayload }) {
  const router = useRouter();
  const search = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [adminEmail, setAdminEmail] = useState("");
  const [planBySlug, setPlanBySlug] = useState<Record<string, "basic" | "premium">>(() => {
    const rec: Record<string, "basic" | "premium"> = {};
    data.businessOverview.forEach((b) => {
      rec[b.slug] = b.plan === "premium" ? "premium" : "basic";
    });
    return rec;
  });
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [tabBySlug, setTabBySlug] = useState<Record<string, "dashboard" | "conversations">>({});
  const [sessionsBySlug, setSessionsBySlug] = useState<Record<string, SessionSummary[]>>({});
  const [selectedSessionBySlug, setSelectedSessionBySlug] = useState<Record<string, string>>({});
  const [messagesByKey, setMessagesByKey] = useState<Record<string, SessionMessage[]>>({});
  const [loadingBiz, setLoadingBiz] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data: u }) => {
      if (!mounted) return;
      setAdminEmail(u.user?.email ?? "");
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/admin/login");
    });
    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } finally {
      router.replace("/admin/login");
    }
  }

  async function updatePlan(slug: string, plan: "basic" | "premium") {
    setSavingSlug(slug);
    setPlanBySlug((prev) => ({ ...prev, [slug]: plan }));
    try {
      const res = await fetch("/api/admin/businesses/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, plan }),
      });
      if (!res.ok) {
        setPlanBySlug((prev) => ({ ...prev, [slug]: data.businessOverview.find((b) => b.slug === slug)?.plan ?? "basic" }));
      }
    } finally {
      setSavingSlug(null);
    }
  }

  function applyDateFilter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const params = new URLSearchParams(search.toString());
    const from = String(form.get("from") || "");
    const to = String(form.get("to") || "");
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    router.push(`/admin/dashboard?${params.toString()}`);
  }

  async function ensureBusinessSessionsLoaded(slug: string) {
    if (sessionsBySlug[slug]?.length) return;
    if (loadingBiz[slug]) return;
    setLoadingBiz((m) => ({ ...m, [slug]: true }));
    try {
      const res = await fetch(`/api/admin/conversations?slug=${encodeURIComponent(slug)}`);
      const j = (await res.json().catch(() => null)) as any;
      const sessions = Array.isArray(j?.sessions) ? (j.sessions as SessionSummary[]) : [];
      setSessionsBySlug((m) => ({ ...m, [slug]: sessions }));
      if (sessions.length && !selectedSessionBySlug[slug]) {
        setSelectedSessionBySlug((m) => ({ ...m, [slug]: sessions[0]!.session_id }));
      }
    } finally {
      setLoadingBiz((m) => ({ ...m, [slug]: false }));
    }
  }

  async function loadSessionMessages(slug: string, sessionId: string) {
    const key = `${slug}::${sessionId}`;
    if (messagesByKey[key]?.length) return;
    const res = await fetch(
      `/api/admin/conversation-messages?slug=${encodeURIComponent(slug)}&session_id=${encodeURIComponent(sessionId)}`
    );
    const j = (await res.json().catch(() => null)) as any;
    const msgs = Array.isArray(j?.messages) ? (j.messages as SessionMessage[]) : [];
    setMessagesByKey((m) => ({ ...m, [key]: msgs }));
  }

  function formatWaitMinutes(iso: string): string {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const mins = Math.max(0, Math.floor(ms / 60000));
    if (mins < 60) return `${mins} דק׳`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}ש׳ ${m}דק׳`;
  }

  const businesses = useMemo(() => {
    const arr = [...data.businessOverview];
    arr.sort((a, b) => Number(b.active) - Number(a.active) || b.conversationsTotal - a.conversationsTotal);
    return arr;
  }, [data.businessOverview]);

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-8" dir="rtl">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="text-right">
            <h1 className="text-2xl font-semibold text-zinc-900">דשבורד סופר אדמין</h1>
            <p className="text-sm text-zinc-500">סקירה מערכתית + עסקים + התראות</p>
            <p className="text-sm mt-1 flex flex-wrap gap-x-4 gap-y-1 justify-end">
              <a className="underline underline-offset-4 text-[#7133da]" href="/admin/requests">
                פניות מבעלי עסקים
              </a>
              <a className="underline underline-offset-4 text-[#7133da]" href="/admin/lp-zoe">
                שיחות זואי - דף נחיתה
              </a>
            </p>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-3">
            <div className="flex items-center gap-2">
              {adminEmail ? (
                <span className="text-xs text-zinc-500" dir="ltr">
                  {adminEmail}
                </span>
              ) : null}
              <Button type="button" variant="outline" onClick={() => void signOut()}>
                התנתקות
              </Button>
            </div>
            <form onSubmit={applyDateFilter} className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="text-xs text-zinc-500">מ־</label>
                <Input name="from" type="date" defaultValue={data.range.from} />
              </div>
              <div>
                <label className="text-xs text-zinc-500">עד</label>
                <Input name="to" type="date" defaultValue={data.range.to} />
              </div>
              <Button type="submit" className="gap-2 bg-[linear-gradient(135deg,#7133da,#ff92ff)] hover:opacity-95">
                <CalendarDays className="h-4 w-4" /> עדכן
              </Button>
            </form>
          </div>
        </div>

        <section className="grid gap-4">
          <Card className="border border-zinc-200 rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" /> ⚠️ Alerts
                </span>
              </CardTitle>
              <CardDescription className="text-right">
                בדיקות חריגות בזמן טעינת הדשבורד
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-zinc-900">הודעות נכנסות ללא מענה (10 דקות+)</p>
                {data.alerts.unanswered.length ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {data.alerts.unanswered.map((a) => (
                      <div key={`${a.slug}-${a.session_id}`} className="rounded-2xl border border-red-200 bg-red-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-red-900">{a.businessName}</p>
                            <p className="text-xs text-red-700 font-mono">{a.slug}</p>
                          </div>
                          <Badge className="border-red-300 text-red-800 bg-white">
                            ממתין {formatWaitMinutes(a.lastAt)}
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <a
                            className="text-sm underline underline-offset-4 text-red-800"
                            href={`/${encodeURIComponent(a.slug)}/conversations`}
                          >
                            מעבר לשיחות
                          </a>
                          <span className="text-[11px] text-red-700 font-mono">{a.session_id}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-600">אין חריגות כרגע.</p>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-zinc-200">
                <p className="text-sm font-semibold text-zinc-900">Fallback חוזר של זואי (יותר מפעם אחת)</p>
                {data.alerts.repeatedFallback.length ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {data.alerts.repeatedFallback.map((a) => (
                      <div key={`${a.slug}-${a.session_id}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-amber-900">{a.businessName}</p>
                            <p className="text-xs text-amber-700 font-mono">{a.slug}</p>
                          </div>
                          <Badge className="border-amber-300 text-amber-900 bg-white">
                            {a.count}x
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <a
                            className="text-sm underline underline-offset-4 text-amber-900"
                            href={`/${encodeURIComponent(a.slug)}/conversations`}
                          >
                            מעבר לשיחות
                          </a>
                          <span className="text-[11px] text-amber-700 font-mono">{a.session_id}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-600">אין חריגות כרגע.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Business Overview</CardTitle>
              <CardDescription>כרטיס לכל עסק + פתיחה inline</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                {businesses.map((b) => {
                  const isExpanded = expandedSlug === b.slug;
                  return (
                    <div key={b.slug} className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next = isExpanded ? null : b.slug;
                          setExpandedSlug(next);
                          if (next) {
                            void ensureBusinessSessionsLoaded(next);
                          }
                        }}
                        className="w-full text-right rounded-2xl border border-zinc-200 bg-white p-4 hover:bg-zinc-50 transition"
                        style={{ borderRadius: 16 }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-zinc-900">{b.name}</p>
                            <p className="text-xs text-zinc-500 font-mono">{b.slug}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge
                              className={
                                b.active
                                  ? "border-emerald-300 text-emerald-800 bg-emerald-50"
                                  : "border-zinc-300 text-zinc-600 bg-zinc-50"
                              }
                            >
                              {b.active ? "פעיל" : "לא פעיל"}
                            </Badge>
                            {b.paused ? (
                              <Badge className="border-red-300 text-red-800 bg-red-50">🔴 pause</Badge>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-700">
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                            <p className="text-[11px] text-zinc-500">שיחות כולל</p>
                            <p className="text-sm font-semibold text-zinc-900">{b.conversationsTotal}</p>
                          </div>
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                            <p className="text-[11px] text-zinc-500">שיחות שבוע</p>
                            <p className="text-sm font-semibold text-zinc-900">{b.conversationsWeek}</p>
                          </div>
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                            <p className="text-[11px] text-zinc-500">Onboarding step</p>
                            <p className="text-sm font-semibold text-zinc-900">{b.onboardingStep ?? "—"}</p>
                          </div>
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                            <p className="text-[11px] text-zinc-500">חבילה</p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-zinc-900">{planBySlug[b.slug] ?? b.plan}</span>
                              <select
                                value={planBySlug[b.slug] ?? "basic"}
                                disabled={savingSlug === b.slug}
                                onChange={(e) => updatePlan(b.slug, e.target.value === "premium" ? "premium" : "basic")}
                                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                              >
                                <option value="basic">basic</option>
                                <option value="premium">premium</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </button>

                      {isExpanded ? (
                        <div className="rounded-2xl border border-[rgba(113,51,218,0.2)] bg-[#faf7ff] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setTabBySlug((m) => ({ ...m, [b.slug]: "dashboard" }))}
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${
                                  (tabBySlug[b.slug] ?? "dashboard") === "dashboard"
                                    ? "bg-white border-[rgba(113,51,218,0.35)] text-[#2d1a6e]"
                                    : "bg-transparent border-zinc-200 text-zinc-700"
                                }`}
                              >
                                דשבורד העסק
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setTabBySlug((m) => ({ ...m, [b.slug]: "conversations" }));
                                  void ensureBusinessSessionsLoaded(b.slug);
                                }}
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${
                                  (tabBySlug[b.slug] ?? "dashboard") === "conversations"
                                    ? "bg-white border-[rgba(113,51,218,0.35)] text-[#2d1a6e]"
                                    : "bg-transparent border-zinc-200 text-zinc-700"
                                }`}
                              >
                                שיחות
                              </button>
                            </div>
                            <a
                              className="text-xs underline underline-offset-4 text-[#7133da]"
                              href={`/${encodeURIComponent(b.slug)}/analytics`}
                            >
                              פתיחה בעסק
                            </a>
                          </div>

                          {(tabBySlug[b.slug] ?? "dashboard") === "dashboard" ? (
                            <div className="mt-3 grid gap-2 md:grid-cols-3">
                              <div className="rounded-2xl border border-zinc-200 bg-white p-3 text-right">
                                <p className="text-xs text-zinc-500">אחוז השלמה (הערכה)</p>
                                <p className="mt-1 text-lg font-semibold text-zinc-900">
                                  {typeof b.onboardingStep === "number" ? Math.min(100, Math.round((b.onboardingStep / 6) * 100)) : "—"}%
                                </p>
                              </div>
                              <div className="rounded-2xl border border-zinc-200 bg-white p-3 text-right">
                                <p className="text-xs text-zinc-500">סה״כ שיחות</p>
                                <p className="mt-1 text-lg font-semibold text-zinc-900">{b.conversationsTotal}</p>
                              </div>
                              <div className="rounded-2xl border border-zinc-200 bg-white p-3 text-right">
                                <p className="text-xs text-zinc-500">שיחות השבוע</p>
                                <p className="mt-1 text-lg font-semibold text-zinc-900">{b.conversationsWeek}</p>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                              <div className="rounded-2xl border border-zinc-200 bg-white p-3 max-h-[360px] overflow-auto">
                                {loadingBiz[b.slug] ? (
                                  <p className="text-sm text-zinc-500 text-right">טוען שיחות…</p>
                                ) : (sessionsBySlug[b.slug] ?? []).length ? (
                                  (sessionsBySlug[b.slug] ?? []).map((s) => (
                                    <button
                                      key={s.session_id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedSessionBySlug((m) => ({ ...m, [b.slug]: s.session_id }));
                                        void loadSessionMessages(b.slug, s.session_id);
                                      }}
                                      className={`w-full text-right rounded-xl border px-3 py-2 mb-2 ${
                                        selectedSessionBySlug[b.slug] === s.session_id
                                          ? "border-[rgba(113,51,218,0.35)] bg-[#f0eaff]"
                                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                                      }`}
                                    >
                                      <p className="text-xs text-zinc-500">טלפון</p>
                                      <p className="text-sm font-medium text-zinc-900">{s.phone || "—"}</p>
                                      <p className="text-[11px] text-zinc-500">
                                        {s.count} הודעות · {new Date(s.lastAt).toLocaleString()}
                                      </p>
                                    </button>
                                  ))
                                ) : (
                                  <p className="text-sm text-zinc-500 text-right">אין שיחות</p>
                                )}
                              </div>
                              <div className="rounded-2xl border border-zinc-200 bg-white p-3 max-h-[360px] overflow-auto">
                                {selectedSessionBySlug[b.slug] ? (
                                  <div className="space-y-2">
                                    <p className="text-xs text-zinc-500 font-mono">
                                      {selectedSessionBySlug[b.slug]}
                                    </p>
                                    {(messagesByKey[`${b.slug}::${selectedSessionBySlug[b.slug]}`] ?? []).map(
                                      (m, idx) => (
                                        <div key={idx} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                                          <div
                                            className={
                                              "max-w-[86%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap border " +
                                              (m.role === "user"
                                                ? "bg-white border-zinc-200 text-zinc-900"
                                                : "bg-[#f0eaff] border-[rgba(113,51,218,0.2)] text-[#2d1a6e]")
                                            }
                                          >
                                            {m.content}
                                          </div>
                                        </div>
                                      )
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-sm text-zinc-500 text-right">בחר/י שיחה כדי לראות הודעות.</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Health</CardTitle>
              <CardDescription>10 שגיאות אחרונות (429/503)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[380px] overflow-auto">
              {data.errorLogs.length === 0 ? (
                <p className="text-sm text-zinc-500 text-right">אין שגיאות 429/503 בטווח הזה.</p>
              ) : data.errorLogs.map((e, i) => (
                <div key={`${e.at}-${i}`} className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <Badge className="border-amber-300 text-amber-700 bg-amber-50">{e.code}</Badge>
                    <span>{new Date(e.at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm mt-1 text-right font-mono">{e.slug}</p>
                  <p className="text-xs text-zinc-500 text-right">{e.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {(data.errors.messagesError || data.errors.conversionsError) && (
          <Card>
            <CardHeader>
              <CardTitle>Data Source Warnings</CardTitle>
              <CardDescription>אזהרות מה־DB</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-amber-700 space-y-1">
              {data.errors.messagesError && <p>messages: {data.errors.messagesError}</p>}
              {data.errors.conversionsError && <p>conversions: {data.errors.conversionsError}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
