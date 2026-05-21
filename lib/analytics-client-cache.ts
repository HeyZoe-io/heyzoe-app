import type { PremiumAnalyticsResult } from "@/lib/analytics-pro-metrics";

export type AnalyticsRangeKey = "month" | "week" | "all";

export type AnalyticsClientPayload = {
  range: AnalyticsRangeKey;
  newLeads: number;
  converted: number;
  conversionRate: number;
  totalChats: number;
  suggestions: string[];
};

export type AnalyticsClientCacheEntry = {
  data: AnalyticsClientPayload;
  premium: PremiumAnalyticsResult | null;
  range: AnalyticsRangeKey;
};

const cache = new Map<string, AnalyticsClientCacheEntry>();

function cacheKey(slug: string, range: AnalyticsRangeKey): string {
  return `${slug.trim().toLowerCase()}:${range}`;
}

export function getAnalyticsClientCache(
  slug: string,
  range: AnalyticsRangeKey
): AnalyticsClientCacheEntry | null {
  return cache.get(cacheKey(slug, range)) ?? null;
}

export function setAnalyticsClientCache(
  slug: string,
  entry: AnalyticsClientCacheEntry
): void {
  cache.set(cacheKey(slug, entry.range), entry);
}

export function clearAnalyticsClientCache(slug?: string): void {
  if (!slug) {
    cache.clear();
    return;
  }
  const prefix = `${slug.trim().toLowerCase()}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
