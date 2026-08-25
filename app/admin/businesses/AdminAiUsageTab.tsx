"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import {
  formatIsraelYearMonth,
  getIsraelDayStartUtc,
  getIsraelMonthStartUtc,
} from "@/lib/israel-time";

type RangePreset = "month" | "3m" | "12m";

type TokenCostBreakdown = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

type MonthBucket = {
  month: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  byCallType: Record<string, TokenCostBreakdown>;
};

type BusinessReport = {
  businessId: number;
  slug: string;
  name: string;
  months: MonthBucket[];
  peakMonth: { month: string; totalCostUsd: number; totalTokens?: number } | null;
  rangeTotalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type ApiResponse = {
  businesses?: BusinessReport[];
  error?: string;
  message?: string;
};

const CALL_TYPE_LABELS: Record<string, string> = {
  generation: "generation",
  editor: "editor",
  classifier: "classifier",
  dashboard_gen: "dashboard_gen",
  opt_out: "opt_out",
  start_intent: "start_intent",
  other: "other",
};

function addCalendarMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function israelPartsFromMonthStart(d: Date): { year: number; month: number } {
  const ym = formatIsraelYearMonth(d);
  const [yStr, mStr] = ym.split("-");
  return { year: Number(yStr), month: Number(mStr) };
}

/** Asia/Jerusalem windows; `to` is exclusive. */
function windowForPreset(preset: RangePreset): { from: string; to: string | null } {
  const now = new Date();
  const thisStart = getIsraelMonthStartUtc(now);
  const { year, month } = israelPartsFromMonthStart(thisStart);

  if (preset === "month") {
    const next = addCalendarMonths(year, month, 1);
    return {
      from: thisStart.toISOString(),
      to: getIsraelDayStartUtc(next.year, next.month, 1).toISOString(),
    };
  }

  const monthsBack = preset === "3m" ? 2 : 11;
  const start = addCalendarMonths(year, month, -monthsBack);
  return {
    from: getIsraelDayStartUtc(start.year, start.month, 1).toISOString(),
    to: null,
  };
}

function formatTokens(n: number): string {
  return Math.round(n || 0).toLocaleString("he-IL");
}

function formatUsd(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return `${m}/${y}`;
}

export function AdminAiUsageTab() {
  const [preset, setPreset] = useState<RangePreset>("12m");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<BusinessReport[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchUsage = useCallback(async (nextPreset: RangePreset) => {
    setLoading(true);
    setError(null);
    const { from, to } = windowForPreset(nextPreset);
    const params = new URLSearchParams();
    params.set("granularity", "month");
    params.set("from", from);
    if (to) params.set("to", to);
    try {
      const res = await fetch(`/api/admin/ai-usage?${params.toString()}`, {
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setBusinesses([]);
        setError(String(json.message || json.error || "שגיאה בטעינת הנתונים"));
        return;
      }
      setBusinesses(Array.isArray(json.businesses) ? json.businesses : []);
    } catch (e) {
      setBusinesses([]);
      setError(e instanceof Error ? e.message : "שגיאה בטעינת הנתונים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsage(preset);
  }, [preset, fetchUsage]);

  const sorted = useMemo(
    () => [...businesses].sort((a, b) => (b.rangeTotalCostUsd || 0) - (a.rangeTotalCostUsd || 0)),
    [businesses]
  );

  const totals = useMemo(() => {
    return sorted.reduce(
      (acc, b) => ({
        inputTokens: acc.inputTokens + (b.inputTokens || 0),
        outputTokens: acc.outputTokens + (b.outputTokens || 0),
        totalTokens: acc.totalTokens + (b.totalTokens || 0),
        costUsd: acc.costUsd + (b.rangeTotalCostUsd || 0),
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
    );
  }, [sorted]);

  const presets: { id: RangePreset; label: string }[] = [
    { id: "month", label: "החודש" },
    { id: "3m", label: "3 חודשים אחרונים" },
    { id: "12m", label: "12 חודשים אחרונים" },
  ];

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-zinc-500">כמות טוקנים ועלות משוערת לפי עסק</p>
        <div className="inline-flex flex-wrap gap-1 rounded-2xl bg-zinc-100/80 p-1">
          {presets.map((p) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={[
                  "rounded-xl px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-white font-medium text-[#7133da] shadow-sm ring-1 ring-[#7133da]/15"
                    : "text-zinc-600 hover:bg-white/70",
                ].join(" ")}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-zinc-500">טוען...</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          לא הצלחנו לטעון את נתוני הטוקנים - {error}
        </div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-zinc-500">
          אין עדיין נתוני ניצול טוקנים. הנתונים יופיעו אחרי ש-AI_USAGE_TRACKING_ENABLED דולק ויש תנועה
          מוקלטת.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="text-right text-xs text-zinc-500">
                <th className="border-b border-zinc-100 px-2 py-3">עסק</th>
                <th className="border-b border-zinc-100 px-2 py-3">טוקנים נכנסים</th>
                <th className="border-b border-zinc-100 px-2 py-3">טוקנים יוצאים</th>
                <th className="border-b border-zinc-100 px-2 py-3">סה״כ טוקנים</th>
                <th className="border-b border-zinc-100 px-2 py-3">עלות ($)</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => {
                const open = expandedId === b.businessId;
                const displayName = (b.name || "").trim() || b.slug || String(b.businessId);
                const months = Array.isArray(b.months) ? b.months : [];
                const peak = b.peakMonth?.month ?? null;
                return (
                  <Fragment key={b.businessId}>
                    <tr
                      className="cursor-pointer border-b border-zinc-100 text-sm hover:bg-zinc-50/80"
                      onClick={() => setExpandedId(open ? null : b.businessId)}
                    >
                      <td className="px-2 py-3">
                        <div className="font-medium text-zinc-900">{displayName}</div>
                        <div className="font-mono text-xs text-zinc-500">{b.slug}</div>
                      </td>
                      <td className="px-2 py-3 tabular-nums text-zinc-800">{formatTokens(b.inputTokens)}</td>
                      <td className="px-2 py-3 tabular-nums text-zinc-800">{formatTokens(b.outputTokens)}</td>
                      <td className="px-2 py-3 tabular-nums font-medium text-zinc-900">
                        {formatTokens(b.totalTokens)}
                      </td>
                      <td className="px-2 py-3 tabular-nums text-zinc-900">{formatUsd(b.rangeTotalCostUsd)}</td>
                    </tr>
                    {open ? (
                      <tr className="border-b border-zinc-100 bg-zinc-50/60">
                        <td colSpan={5} className="px-3 py-3">
                          {months.length === 0 ? (
                            <div className="text-sm text-zinc-500">אין פירוט חודשי בחלון שנבחר.</div>
                          ) : (
                            <div className="space-y-3">
                              {[...months].reverse().map((m) => {
                                const isPeak = peak != null && m.month === peak;
                                const callEntries = Object.entries(m.byCallType ?? {}).sort((a, b2) =>
                                  a[0].localeCompare(b2[0])
                                );
                                return (
                                  <div
                                    key={m.month}
                                    className={[
                                      "rounded-xl border px-3 py-2",
                                      isPeak
                                        ? "border-[#7133da]/35 bg-[#7133da]/5"
                                        : "border-zinc-200 bg-white",
                                    ].join(" ")}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                      <div className="flex items-center gap-2 font-medium text-zinc-900">
                                        <span>{formatMonthLabel(m.month)}</span>
                                        {isPeak ? (
                                          <span className="inline-flex rounded-full border border-[#7133da]/20 bg-white px-2 py-0.5 text-[11px] text-[#7133da]">
                                            שיא
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="tabular-nums text-zinc-700">
                                        {formatTokens(m.totalTokens)} טוקנים · {formatUsd(m.totalCostUsd)}
                                      </div>
                                    </div>
                                    {callEntries.length > 0 ? (
                                      <div className="mt-2 grid gap-1 sm:grid-cols-2">
                                        {callEntries.map(([ctype, row]) => (
                                          <div
                                            key={ctype}
                                            className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-1 text-xs text-zinc-600"
                                          >
                                            <span>{CALL_TYPE_LABELS[ctype] ?? ctype}</span>
                                            <span className="tabular-nums">
                                              {formatTokens(row.totalTokens)} · {formatUsd(row.costUsd)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 text-sm font-semibold text-zinc-900">
                <td className="px-2 py-3">סה״כ</td>
                <td className="px-2 py-3 tabular-nums">{formatTokens(totals.inputTokens)}</td>
                <td className="px-2 py-3 tabular-nums">{formatTokens(totals.outputTokens)}</td>
                <td className="px-2 py-3 tabular-nums">{formatTokens(totals.totalTokens)}</td>
                <td className="px-2 py-3 tabular-nums">{formatUsd(totals.costUsd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
