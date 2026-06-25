import { isWaAttributedPurchaseSource } from "@/lib/lp-analytics";

export type LandingSourceBreakdownRow = {
  source: string;
  count: number;
  purchases: number;
  revenue: number;
  revenuePct: number;
};

export type LandingCampaignBreakdownRow = {
  utm_source: string;
  utm_campaign: string;
  utm_content: string;
  count: number;
  revenue: number;
};

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
  sourcesBreakdown: LandingSourceBreakdownRow[];
  sourcesBreakdownMax: number;
  campaignBreakdown: LandingCampaignBreakdownRow[];
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
  metadata?: Record<string, unknown> | null;
};

type SourceStats = {
  allEvents: number;
  purchases: number;
  revenue: number;
  sessions: Set<string>;
};

/** IPN purchase rows use session_id lp_biz_<businessId> — exclude from LP funnel / avgDaysToPurchase. */
function isIpnBizPurchaseSession(sessionId: string): boolean {
  return sessionId.startsWith("lp_biz_");
}

function utmDisplay(value: unknown): string {
  const s = String(value ?? "").trim();
  return s || "(ללא)";
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Campaign UTM table: LP-attributed purchases only (not wa_marketing). */
function isLandingCampaignPurchaseSource(source: string | null | undefined): boolean {
  const s = String(source ?? "").trim().toLowerCase();
  return s === "landing_page" || s === "unknown";
}

export function buildLandingAnalyticsSnapshot(
  events: EventRow[],
  sourceMode: "all" | "purchases"
): LandingAnalyticsSnapshot {
  const countByType = new Map<string, number>();
  const firstPageviewAtBySession = new Map<string, number>();
  const firstPurchaseAtBySession = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const purchaserSessionsBySource = new Map<string, Set<string>>();
  const sourceStats = new Map<string, SourceStats>();
  const campaignStats = new Map<
    string,
    { utm_source: string; utm_campaign: string; utm_content: string; count: number; revenue: number }
  >();
  const ctaClicksByLabel = new Map<string, number>();
  let purchaseRevenue = 0;
  let funnelPurchaseCount = 0;
  let waLpCheckout = 0;
  let waLpPurchases = 0;
  let waLpRevenue = 0;

  for (const e of events) {
    const t = String(e.event_type ?? "").trim();
    const sid = String(e.session_id ?? "").trim();
    if (!t || !sid) continue;

    const isIpnPurchase = t === "purchase" && isIpnBizPurchaseSession(sid);

    countByType.set(t, (countByType.get(t) ?? 0) + 1);
    if (t === "purchase" && !isIpnPurchase) funnelPurchaseCount += 1;

    const atMs = new Date(e.created_at).getTime();
    if (Number.isFinite(atMs)) {
      if (t === "pageview") {
        const prev = firstPageviewAtBySession.get(sid);
        if (!prev || atMs < prev) firstPageviewAtBySession.set(sid, atMs);
      }
      if (t === "purchase" && !isIpnPurchase) {
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

      const meta = parseMetadata(e.metadata);
      if (meta != null && isLandingCampaignPurchaseSource(e.source)) {
        const utm_source = utmDisplay(meta.utm_source);
        const utm_campaign = utmDisplay(meta.utm_campaign);
        const utm_content = utmDisplay(meta.utm_content);
        const key = `${utm_source}|${utm_campaign}|${utm_content}`;
        const prev = campaignStats.get(key) ?? { utm_source, utm_campaign, utm_content, count: 0, revenue: 0 };
        prev.count += 1;
        if (Number.isFinite(v) && v > 0) prev.revenue += v;
        campaignStats.set(key, prev);
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

    const stats = sourceStats.get(src) ?? { allEvents: 0, purchases: 0, revenue: 0, sessions: new Set<string>() };
    stats.allEvents += 1;
    if (t === "purchase") {
      stats.purchases += 1;
      stats.sessions.add(sid);
      const v = typeof e.value === "number" ? e.value : e.value != null ? Number(e.value) : NaN;
      if (Number.isFinite(v) && v > 0) stats.revenue += v;

      const set = purchaserSessionsBySource.get(src) ?? new Set<string>();
      set.add(sid);
      purchaserSessionsBySource.set(src, set);
    }
    sourceStats.set(src, stats);
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

  const funnelCounts = funnelSteps.map((s) => (s === "purchase" ? funnelPurchaseCount : countByType.get(s) ?? 0));
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

  const sourcesBreakdown = [...sourceStats.entries()]
    .map(([source, s]) => ({
      source,
      count: sourceMode === "purchases" ? s.sessions.size : s.allEvents,
      purchases: s.purchases,
      revenue: s.revenue,
      revenuePct: purchaseRevenue > 0 ? Math.round((s.revenue / purchaseRevenue) * 100) : 0,
    }))
    .filter((row) => row.count > 0 || row.purchases > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const sourcesBreakdownMax = sourcesBreakdown[0]?.count ?? 1;

  const campaignBreakdown = [...campaignStats.values()]
    .sort((a, b) => b.revenue - a.revenue || b.count - a.count)
    .slice(0, 30);

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
    sourcesBreakdown,
    sourcesBreakdownMax,
    campaignBreakdown,
    ctaLabelsSorted,
    waLpCheckout,
    waLpPurchases,
    waLpRevenue,
  };
}
