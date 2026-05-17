import { isWaAttributedPurchaseSource } from "@/lib/lp-analytics";

export type LandingAnalyticsSnapshot = {
  pageviews: number;
  purchases: number;
  purchaseRevenue: number;
  avgDaysToPurchase: number;
  funnelSteps: readonly string[];
  funnelCounts: number[];
  funnelBase: number;
  checkoutStarts: number;
  abandoned: number;
  abandonmentRate: number;
  sourcesSorted: [string, number][];
  sourcesMax: number;
  ctaLabelsSorted: [string, number][];
  waLpCheckout: number;
  waLpPurchases: number;
  waLpRevenue: number;
};

type EventRow = {
  event_type: string;
  value: number | null;
  source: string | null;
  label: string | null;
  session_id: string;
  created_at: string;
};

export function buildLandingAnalyticsSnapshot(
  events: EventRow[],
  sourceMode: "all" | "purchases"
): LandingAnalyticsSnapshot {
  const countByType = new Map<string, number>();
  const firstPageviewAtBySession = new Map<string, number>();
  const firstPurchaseAtBySession = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const purchaserSessionsBySource = new Map<string, Set<string>>();
  const ctaClicksByLabel = new Map<string, number>();
  let purchaseRevenue = 0;
  let waLpCheckout = 0;
  let waLpPurchases = 0;
  let waLpRevenue = 0;

  for (const e of events) {
    const t = String(e.event_type ?? "").trim();
    const sid = String(e.session_id ?? "").trim();
    if (!t || !sid) continue;

    countByType.set(t, (countByType.get(t) ?? 0) + 1);

    const atMs = new Date(e.created_at).getTime();
    if (Number.isFinite(atMs)) {
      if (t === "pageview") {
        const prev = firstPageviewAtBySession.get(sid);
        if (!prev || atMs < prev) firstPageviewAtBySession.set(sid, atMs);
      }
      if (t === "purchase") {
        const prev = firstPurchaseAtBySession.get(sid);
        if (!prev || atMs < prev) firstPurchaseAtBySession.set(sid, atMs);
      }
    }

    if (t === "purchase") {
      const v = typeof e.value === "number" ? e.value : e.value != null ? Number(e.value) : NaN;
      if (Number.isFinite(v) && v > 0) {
        purchaseRevenue += v;
        if (isWaAttributedPurchaseSource(e.source)) waLpRevenue += v;
      }
    }

    if (t === "checkout_start" && isWaAttributedPurchaseSource(e.source)) waLpCheckout += 1;
    if (t === "purchase" && isWaAttributedPurchaseSource(e.source)) waLpPurchases += 1;

    if (t === "cta_click") {
      const lbl = (e.label ?? "").trim() || "לא מזוהה";
      ctaClicksByLabel.set(lbl, (ctaClicksByLabel.get(lbl) ?? 0) + 1);
    }

    const src = (e.source ?? "").trim() || "direct";
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
    if (t === "purchase") {
      const set = purchaserSessionsBySource.get(src) ?? new Set<string>();
      set.add(sid);
      purchaserSessionsBySource.set(src, set);
    }
  }

  const pageviews = countByType.get("pageview") ?? 0;
  const purchases = countByType.get("purchase") ?? 0;

  const deltasDays: number[] = [];
  for (const [sid, pvMs] of firstPageviewAtBySession.entries()) {
    const prMs = firstPurchaseAtBySession.get(sid);
    if (!prMs) continue;
    const d = (prMs - pvMs) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(d) && d >= 0) deltasDays.push(d);
  }
  const avgDaysToPurchase =
    deltasDays.length ? deltasDays.reduce((a, b) => a + b, 0) / deltasDays.length : 0;

  const funnelSteps = [
    "pageview",
    "lp_10s",
    "lp_30s",
    "lp_60s",
    "lp_scroll_50",
    "lp_scroll_75",
    "cta_click",
    "chat_open",
    "checkout_start",
    "purchase",
  ] as const;

  const funnelCounts = funnelSteps.map((s) => countByType.get(s) ?? 0);
  const funnelBase = funnelCounts[0] || 0;
  const checkoutStarts = countByType.get("checkout_start") ?? 0;
  const abandoned = Math.max(0, checkoutStarts - purchases);
  const abandonmentRate = checkoutStarts ? Math.round((abandoned / checkoutStarts) * 100) : 0;

  const sourcesAllSorted = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const sourcesPurchSorted = [...purchaserSessionsBySource.entries()]
    .map(([src, set]) => [src, set.size] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const sourcesSorted = (sourceMode === "purchases" ? sourcesPurchSorted : sourcesAllSorted) as [string, number][];
  const sourcesMax = sourcesSorted[0]?.[1] ?? 1;
  const ctaLabelsSorted = [...ctaClicksByLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20) as [
    string,
    number,
  ][];

  return {
    pageviews,
    purchases,
    purchaseRevenue,
    avgDaysToPurchase,
    funnelSteps,
    funnelCounts,
    funnelBase,
    checkoutStarts,
    abandoned,
    abandonmentRate,
    sourcesSorted,
    sourcesMax,
    ctaLabelsSorted,
    waLpCheckout,
    waLpPurchases,
    waLpRevenue,
  };
}
