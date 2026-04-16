export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
  });

  const j = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || j === null) {
    throw new Error(`request_failed:${res.status}`);
  }
  return j;
}

export type DashboardSettingsPayload = {
  error?: string;
  business?: Record<string, unknown> | null;
  services?: unknown[];
};

export function dashboardSettingsKey(slug: string) {
  return slug ? `dashboard-settings:${slug}` : null;
}

export async function dashboardSettingsFetcher(key: string): Promise<DashboardSettingsPayload> {
  const slug = String(key.split(":")[1] ?? "").trim();
  return await fetchJson<DashboardSettingsPayload>(
    `/api/dashboard/settings?slug=${encodeURIComponent(slug)}`
  );
}

export type AnalyticsApiPayload = {
  ok?: boolean;
  error?: string;
  range?: "month" | "week" | "all";
  newLeads?: number;
  converted?: number;
  conversionRate?: number;
  totalChats?: number;
  suggestions?: string[];
};

export function analyticsKey(slug: string, range: "month" | "week" | "all") {
  return slug ? `analytics:${slug}:${range}` : null;
}

export async function analyticsFetcher(key: string): Promise<AnalyticsApiPayload> {
  const parts = key.split(":");
  const slug = String(parts[1] ?? "").trim();
  const range = String(parts[2] ?? "month").trim();
  return await fetchJson<AnalyticsApiPayload>(
    `/api/analytics?business_slug=${encodeURIComponent(slug)}&range=${encodeURIComponent(range)}`
  );
}
