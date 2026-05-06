"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { PremiumAnalyticsResult } from "@/lib/analytics-pro-metrics";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

type RangeKey = "month" | "week" | "all";

type AnalyticsPayload = {
  range: RangeKey;
  newLeads: number;
  converted: number;
  conversionRate: number;
  totalChats: number;
  suggestions: string[];
};

function resolveRangeKey(raw: unknown): RangeKey {
  const r = String(raw ?? "").trim().toLowerCase();
  if (r === "week" || r === "all") return r;
  return "month";
}

function updateUrlRange(slug: string, range: RangeKey) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("range", range);
    window.history.replaceState({}, "", `/${encodeURIComponent(slug)}/analytics?${u.searchParams.toString()}`);
  } catch {
    /* noop */
  }
}

function formatDayTick(ymd: string) {
  const p = ymd.split("-");
  if (p.length !== 3) return ymd;
  return `${p[2]}/${p[1]}`;
}

function leadsChartShim(rows: PremiumAnalyticsResult["leadsByDay"]) {
  return rows.map((r) => ({
    ...r,
    label: formatDayTick(r.date),
  }));
}

function hourBuckets(counts24: number[]) {
  return counts24.map((count, hour) => ({ hour: String(hour), count }));
}

export default function AnalyticsClient({
  slug,
  planIsPremium,
  initialRange,
  initial,
  premiumInitial,
}: {
  slug: string;
  planIsPremium: boolean;
  initialRange: RangeKey;
  initial: AnalyticsPayload;
  premiumInitial: PremiumAnalyticsResult | null;
}) {
  const [range, setRange] = useState<RangeKey>(initialRange);
  const [data, setData] = useState<AnalyticsPayload>(initial);
  const [premium, setPremium] = useState<PremiumAnalyticsResult | null>(() => premiumInitial);
  const [loading, setLoading] = useState(false);
  const lastLoadedRangeRef = useRef<RangeKey>(initialRange);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<{ ac: AbortController | null; reqId: number }>({ ac: null, reqId: 0 });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        inFlightRef.current.ac?.abort();
      } catch {
        /* noop */
      }
    };
  }, []);

  const subtitle = useMemo(() => {
    const suffix =
      range === "week" ? "שבוע אחרון" : range === "all" ? "כל הזמן" : "חודש";
    return `לידים, המרות ושיעור המרה (${suffix})`;
  }, [range]);

  async function load(next: RangeKey) {
    try {
      inFlightRef.current.ac?.abort();
    } catch {
      /* noop */
    }
    const ac = new AbortController();
    inFlightRef.current.ac = ac;
    const reqId = ++inFlightRef.current.reqId;

    setLoading(true);
    try {
      const ext = planIsPremium ? "&extended=1" : "";
      const res = await fetch(
        `/api/analytics?business_slug=${encodeURIComponent(slug)}&range=${encodeURIComponent(next)}&lite=1${ext}`,
        { method: "GET", signal: ac.signal }
      );
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) return;

      if (!mountedRef.current) return;
      if (reqId !== inFlightRef.current.reqId) return;

      try {
        const path = window.location.pathname || "";
        if (!path.endsWith(`/${slug}/analytics`) && !path.includes(`/${slug}/analytics`)) return;
      } catch {
        /* noop */
      }

      const payload: AnalyticsPayload = {
        range: resolveRangeKey(j.range),
        newLeads: Number(j.newLeads ?? 0) || 0,
        converted: Number(j.converted ?? 0) || 0,
        conversionRate: Number(j.conversionRate ?? 0) || 0,
        totalChats: Number(j.totalChats ?? 0) || 0,
        suggestions:
          Array.isArray(j.suggestions) && j.suggestions.length
            ? j.suggestions.map((x: any) => String(x ?? ""))
            : data.suggestions,
      };

      setData(payload);

      if (planIsPremium && j?.pro === true && Array.isArray(j.leadsByDay) && Array.isArray(j.inboundMessagesByHour)) {
        setPremium({
          leadsByDay: j.leadsByDay.map((row: any) => ({
            date: String(row?.date ?? ""),
            count: Number(row?.count ?? 0) || 0,
          })),
          inboundMessagesByHour: [...(j.inboundMessagesByHour as number[])],
          followupReturnCount: Number(j.followupReturnCount ?? 0) || 0,
          popularTrainings: Array.isArray(j.popularTrainings)
            ? j.popularTrainings.map((r: any) => ({
                name: String(r?.name ?? ""),
                count: Number(r?.count ?? 0) || 0,
              }))
            : [],
        });
      } else if (!planIsPremium) {
        setPremium(null);
      }

      updateUrlRange(slug, payload.range);
      lastLoadedRangeRef.current = payload.range;
    } catch (e: any) {
      if (e?.name === "AbortError") return;
    } finally {
      if (mountedRef.current && reqId === inFlightRef.current.reqId) setLoading(false);
    }
  }

  useEffect(() => {
    if (range === initialRange) return;
    void load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    const onFocus = () => {
      if (loading) return;
      void load(lastLoadedRangeRef.current);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const leadsPlot = useMemo(
    () => (premium?.leadsByDay?.length ? leadsChartShim(premium.leadsByDay) : []),
    [premium?.leadsByDay]
  );
  const peakPlot = useMemo(
    () => (premium?.inboundMessagesByHour?.length === 24 ? hourBuckets(premium.inboundMessagesByHour) : []),
    [premium?.inboundMessagesByHour]
  );

  const chartPurple = "#7133da";
  const isEmpty = !loading && (Number(data.totalChats ?? 0) || 0) === 0;

  return (
    <div className="space-y-6 relative" aria-busy={loading ? "true" : "false"}>
      <div className="hz-wave hz-wave-1">
        <h1 className="text-2xl font-semibold text-zinc-900 text-right">אנליטיקס ל-{slug}</h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-sm text-zinc-600 text-right">{subtitle}</p>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" aria-hidden /> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${range === "week" ? "bg-zinc-900 text-white shadow-sm" : "bg-white/70 text-zinc-700 hover:bg-white"}`}
              onClick={() => setRange("week")}
              disabled={loading}
            >
              שבוע אחרון
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${range === "month" ? "bg-zinc-900 text-white shadow-sm" : "bg-white/70 text-zinc-700 hover:bg-white"}`}
              onClick={() => setRange("month")}
              disabled={loading}
            >
              חודש
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${range === "all" ? "bg-zinc-900 text-white shadow-sm" : "bg-white/70 text-zinc-700 hover:bg-white"}`}
              onClick={() => setRange("all")}
              disabled={loading}
            >
              כל הזמן
            </button>
          </div>
        </div>
      </div>

      {isEmpty ? (
        <section className="hz-wave hz-wave-2">
          <div className="rounded-2xl border border-zinc-200/70 bg-white/80 backdrop-blur p-8 text-right">
            <p className="text-sm text-zinc-700 text-center" dir="rtl">
              אין כרגע מה להציג כאן :)
            </p>
          </div>
        </section>
      ) : (
      <section className="grid gap-4 md:grid-cols-3 hz-wave hz-wave-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-zinc-200/70 bg-white/75 backdrop-blur p-4">
              <div className="h-3 w-28 rounded bg-zinc-200 ml-auto animate-pulse" />
              <div className="mt-3 h-8 w-20 rounded bg-zinc-200 ml-auto animate-pulse" />
            </div>
          ))
        ) : (
          <>
            <div className="rounded-2xl border border-zinc-200/70 bg-white/80 backdrop-blur p-4 text-right">
              <p className="text-xs text-zinc-500">לידים חדשים</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">{data.newLeads}</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/70 bg-white/80 backdrop-blur p-4 text-right">
              <p className="text-xs text-zinc-500">המרות (נרשמו לשיעור ניסיון)</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-600">{data.converted}</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/70 bg-white/80 backdrop-blur p-4 text-right">
              <p className="text-xs text-zinc-500">שיעור המרה</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-600">{data.conversionRate}%</p>
              <p className="mt-1 text-[11px] text-zinc-500">מתוך {data.totalChats} צ׳אטים (פר מספר)</p>
            </div>
          </>
        )}
      </section>

      {planIsPremium ? (
        <section className="space-y-4 hz-wave hz-wave-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-right border-b border-white/70 pb-2">
            <h2 className="text-lg font-semibold text-zinc-900">ניתוח Pro</h2>
            <span className="rounded-full bg-[#f7f3ff] border border-[#7133da]/25 px-2.5 py-0.5 text-[11px] font-semibold text-[#7133da]">
              כללי בחשבון Pro בלבד
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200/70 bg-white/80 backdrop-blur p-4 text-right">
              <p className="text-sm font-semibold text-zinc-900">לידים חדשים לפי יום</p>
              <p className="mt-1 text-[11px] text-zinc-500">משתמש ב-contact.created_at (אזור ישראל)</p>
              {loading && planIsPremium ? (
                <div className="h-[260px] flex items-center justify-center text-zinc-400 text-sm gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" /> טוען…
                </div>
              ) : leadsPlot.length === 0 ? (
                <p className="mt-8 text-center text-sm text-zinc-500 py-16">אין נתוני לידים בטווח שנבחר</p>
              ) : (
                <div dir="ltr" className="mt-2 h-[260px] w-full outline-none [&_.recharts-surface]:outline-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={leadsPlot} margin={{ top: 10, left: -20, right: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" opacity={0.7} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis tick={{ fill: "#71717a", fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(v) => [`${Number(v ?? 0)}`, "לידים"]}
                        labelFormatter={(l, payload) => {
                          const list = payload as unknown as { payload?: { date?: string } }[] | undefined;
                          const d = String(list?.[0]?.payload?.date ?? "");
                          return d ? `תאריך ${formatDayTick(d)}` : String(l ?? "");
                        }}
                        contentStyle={{ borderRadius: 12, direction: "rtl", textAlign: "right" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="לידים"
                        stroke={chartPurple}
                        fill={chartPurple}
                        fillOpacity={0.14}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-200/70 bg-white/80 backdrop-blur p-4 text-right">
              <p className="text-sm font-semibold text-zinc-900">שעות שיא (הודעות נכנסות)</p>
              <p className="mt-1 text-[11px] text-zinc-500">משתמש בשעון ישראל · תפקיד user</p>
              {loading && planIsPremium ? (
                <div className="h-[260px] flex items-center justify-center text-zinc-400 text-sm gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" /> טוען…
                </div>
              ) : peakPlot.every((x) => x.count === 0) ? (
                <p className="mt-8 text-center text-sm text-zinc-500 py-16">אין הודעות נכנסות בטווח</p>
              ) : (
                <div dir="ltr" className="mt-2 h-[260px] w-full [&_.recharts-surface]:outline-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={peakPlot} margin={{ top: 10, left: -20, right: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" opacity={0.7} />
                      <XAxis dataKey="hour" tick={{ fill: "#71717a", fontSize: 9 }} interval={3} />
                      <YAxis tick={{ fill: "#71717a", fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(v) => [`${Number(v ?? 0)}`, "הודעות"]}
                        labelFormatter={(h) => `שעה ${String(h ?? "")}`}
                        contentStyle={{ borderRadius: 12, direction: "rtl", textAlign: "right" }}
                      />
                      <Bar dataKey="count" name="הודעות" fill={`${chartPurple}cc`} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200/70 bg-white/80 backdrop-blur p-4 text-right lg:col-span-1">
              <p className="text-xs text-zinc-500">חזרו אחרי פולואפ</p>
              <p className="mt-2 text-[11px] text-zinc-500 leading-snug">
                ליד שנשלח לו WA follow-up (שלבים 1–3) ולאחריו נשלחה הודעת משתמש נוספת
              </p>
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-zinc-300 mt-4" aria-hidden />
              ) : (
                <p className="mt-3 text-2xl font-semibold text-emerald-600 tabular-nums">
                  {premium?.followupReturnCount ?? 0}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200/70 bg-white/80 backdrop-blur overflow-hidden">
            <div className="p-4 border-b border-zinc-100 text-right space-y-1">
              <p className="text-sm font-semibold text-zinc-900">אימונים פופולריים</p>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                ספירת הופעות שם השירות מתוך services בטקסטי הודעות נכנסות (בטווח הזמן)
              </p>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 justify-center py-12 text-zinc-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : !premium?.popularTrainings?.length ? (
              <p className="py-12 text-center text-sm text-zinc-500 px-4">אין עדיין התאמות לפי טקסט בטווח זה</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[280px] w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/90 text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-100">
                      <th className="py-3 pr-4 font-medium text-right border-b border-zinc-100">אימון</th>
                      <th className="py-3 pl-4 font-medium text-center border-b border-zinc-100 w-[7rem]">אזכורים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {premium.popularTrainings.map((row) => (
                      <tr key={row.name} className="border-b border-zinc-100/90 last:border-0 hover:bg-[#faf8ff]/80">
                        <td className="py-3 pr-4 font-medium text-zinc-900">{row.name}</td>
                        <td className="py-3 pl-4 text-center tabular-nums text-zinc-800">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}
      )}
    </div>
  );
}
