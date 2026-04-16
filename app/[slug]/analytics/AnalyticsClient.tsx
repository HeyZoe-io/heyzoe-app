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
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [isNew, setIsNew] = useState<Record<string, boolean>>({});
  const [savePulse, setSavePulse] = useState(false);
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
        `/api/analytics?business_slug=${encodeURIComponent(slug)}&range=${encodeURIComponent(next)}`,
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
        suggestions: Array.isArray(j.suggestions) ? j.suggestions.map((x: any) => String(x ?? "")) : [],
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

  const suggestionCards = useMemo(() => {
    return (data.suggestions ?? []).map((text) => ({ id: text, text }));
  }, [data.suggestions]);

  function replaceSuggestion(id: string) {
    if (replacing[id]) return;
    setReplacing((m) => ({ ...m, [id]: true }));
    window.setTimeout(() => {
      const variants = [
        "שווה להוסיף גילאים וקהל יעד - כדי שזואי תדע למי זה מתאים בדיוק.",
        "אם יש חלוקה לרמות - ציינו את הרמות לכל אימון ניסיון, זה חוסך שאלות בצ׳אט.",
        "כדאי לציין חניה/הנחיות הגעה כדי שהמענה יהיה מלא ומהיר.",
        "אם יש מדיניות ביטול - הוסיפו אותה כדי למנוע בלבול בשאלות פתוחות.",
      ];
      const pick = variants[Math.floor(Math.random() * variants.length)] ?? "כדאי להוסיף עוד פרט קטן שיעזור לזואי לענות.";
      setData((d) => ({
        ...d,
        suggestions: d.suggestions.map((s) => (s === id ? pick : s)),
      }));
      setIsNew((m) => ({ ...m, [pick]: true }));
      setReplacing((m) => ({ ...m, [id]: false }));
    }, 600);
  }

  async function saveSuggestions() {
    const chosen = suggestionCards.filter((c) => accepted[c.id]).map((c) => c.text);
    const text = chosen.join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setSavePulse(true);
      window.setTimeout(() => setSavePulse(false), 650);
    } catch {
      setSavePulse(true);
      window.setTimeout(() => setSavePulse(false), 650);
    }
  }

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

      <section className={`grid gap-4 md:grid-cols-3 hz-wave hz-wave-2 ${loading ? "opacity-25" : ""}`.trim()}>
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
      </section>

      <section className={`grid gap-4 md:grid-cols-1 hz-wave hz-wave-3 ${loading ? "opacity-25" : ""}`.trim()}>
        <div
          dir="rtl"
          className="text-right"
          style={{
            background: "#f5f3ff",
            borderRadius: 16,
            padding: 24,
            fontFamily: "Fredoka, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#2d1a6e" }}>
              הצעות לשיפור מסלול המכירה
            </div>
            <div style={{ fontSize: 13, color: "#8b7ec0", marginTop: 4 }}>
              מסלול מכירה/פרטי העסק/כל העובדות שכדאי לציין על העסק
            </div>
          </div>

          {suggestionCards.length ? (
            <div className="space-y-3">
              {suggestionCards.map((c) => {
                const done = Boolean(accepted[c.id]);
                const busy = Boolean(replacing[c.id]);
                const fresh = Boolean(isNew[c.id]);
                return (
                  <div
                    key={c.id}
                    className={`${fresh ? "hz-fade-in" : ""}`.trim()}
                    style={{
                      background: done ? "#f5fff8" : "#fff",
                      borderRadius: 14,
                      border: done ? "1.5px solid #35ff70" : "1.5px solid #e8e0ff",
                      padding: "16px 18px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 14,
                    }}
                  >
                    <div style={{ flex: 1, fontSize: 14, color: "#2d1a6e", lineHeight: 1.6 }}>
                      {fresh ? (
                        <span
                          style={{
                            display: "inline-block",
                            background: "#f0edff",
                            color: "#7133da",
                            borderRadius: 20,
                            fontSize: 11,
                            padding: "2px 8px",
                            marginBottom: 8,
                          }}
                        >
                          ✨ חדש
                        </span>
                      ) : null}

                      {busy ? (
                        <div>
                          <div
                            className="animate-pulse"
                            style={{ height: 12, borderRadius: 10, background: "#e8e0ff", width: "86%" }}
                          />
                          <div
                            className="animate-pulse"
                            style={{ height: 12, borderRadius: 10, background: "#e8e0ff", width: "62%", marginTop: 10 }}
                          />
                        </div>
                      ) : (
                        <div>{c.text}</div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        aria-label="אישור"
                        disabled={done}
                        onClick={() => setAccepted((m) => ({ ...m, [c.id]: true }))}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          border: "none",
                          background: done ? "#35ff70" : "#e8fff0",
                          color: done ? "#0a4a1e" : "#27a85a",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: done ? "default" : "pointer",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        ✓
                      </button>

                      <button
                        type="button"
                        aria-label="החלפה"
                        onClick={() => replaceSuggestion(c.id)}
                        disabled={busy}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          border: "none",
                          background: busy ? "#f5f0ff" : "#f5f0ff",
                          color: "#7133da",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: busy ? "default" : "pointer",
                          opacity: done ? 0.9 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (busy) return;
                          (e.currentTarget as HTMLButtonElement).style.background = "#ede5ff";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = "#f5f0ff";
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M2 8a6 6 0 0 1 10.5-3.9M14 8a6 6 0 0 1-10.5 3.9M11 4l1.5-1.5L14 4M5 12l-1.5 1.5L2 12"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={saveSuggestions}
                  style={{
                    background: "#7133da",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "8px 16px",
                    fontFamily: "Fredoka, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
                    fontSize: 13,
                    border: "none",
                    opacity: savePulse ? 0.88 : 1,
                    transition: "opacity 180ms ease",
                  }}
                >
                  שמור הצעות
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "#2d1a6e", lineHeight: 1.6 }}>
              נראה שהמידע המרכזי כבר מלא. אפשר להוסיף פרטים נקודתיים לפי שאלות שעולות מהלידים.
            </div>
          )}
        </div>
      </section>

      {loading ? (
        <div className="absolute inset-0 pointer-events-none">
          <div className="space-y-6 animate-pulse">
            <section className="grid gap-4 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-zinc-200/70 bg-white/75 backdrop-blur p-4">
                  <div className="h-3 w-28 rounded bg-zinc-200 ml-auto" />
                  <div className="mt-3 h-8 w-20 rounded bg-zinc-200 ml-auto" />
                </div>
              ))}
            </section>
            <section className="grid gap-4 md:grid-cols-1">
              <div className="rounded-2xl border border-zinc-200/70 bg-white/75 backdrop-blur p-4">
                <div className="h-4 w-48 rounded bg-zinc-200 ml-auto" />
                <div className="mt-3 h-3 w-72 rounded bg-zinc-200 ml-auto" />
                <div className="mt-4 h-3 w-[92%] rounded bg-zinc-200 ml-auto" />
                <div className="mt-2 h-3 w-[82%] rounded bg-zinc-200 ml-auto" />
                <div className="mt-2 h-3 w-[88%] rounded bg-zinc-200 ml-auto" />
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

