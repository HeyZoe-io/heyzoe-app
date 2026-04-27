"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

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

export default function AnalyticsClient({
  slug,
  initialRange,
  initial,
}: {
  slug: string;
  initialRange: RangeKey;
  initial: AnalyticsPayload;
}) {
  const [range, setRange] = useState<RangeKey>(initialRange);
  const [data, setData] = useState<AnalyticsPayload>(initial);
  const [loading, setLoading] = useState(false);
  const lastLoadedRangeRef = useRef<RangeKey>(initialRange);

  const subtitle = useMemo(() => {
    const suffix =
      range === "week" ? "שבוע אחרון" : range === "all" ? "כל הזמן" : "חודש";
    return `לידים, המרות ושיעור המרה (${suffix})`;
  }, [range]);

  async function load(next: RangeKey) {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/analytics?business_slug=${encodeURIComponent(slug)}&range=${encodeURIComponent(next)}&lite=1`,
        { method: "GET" }
      );
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) return;
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
      updateUrlRange(slug, payload.range);
      lastLoadedRangeRef.current = payload.range;
    } finally {
      setLoading(false);
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
    </div>
  );
}

