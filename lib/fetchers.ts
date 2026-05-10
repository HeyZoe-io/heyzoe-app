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
  const url = `/api/dashboard/settings?slug=${encodeURIComponent(slug)}`;
  const fetchOnce = () => fetchJson<DashboardSettingsPayload>(url);

  const namedIn = (p: DashboardSettingsPayload) =>
    Array.isArray(p.services) && p.services.some((s) => String((s as { name?: unknown })?.name ?? "").trim());

  /** אחרי דיפלוי / עומס, מערך השירותים לפעמים חוזה ריק לפני שה־DB מספיק — חוזר עד כמה פעמים עם המתנה */
  const MAX_ATTEMPTS = 4;
  const WAIT_BETWEEN_MS = [480, 800, 1200];
  let last: DashboardSettingsPayload | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, WAIT_BETWEEN_MS[attempt - 1] ?? 600));
    }
    try {
      const payload = await fetchOnce();
      last = payload;
      const businessOk = payload.business != null && !payload.error;
      if (!businessOk || namedIn(payload)) return payload;
    } catch (e) {
      if (attempt === MAX_ATTEMPTS - 1) {
        if (last !== undefined) return last;
        throw e instanceof Error ? e : new Error("request_failed:dashboard-settings");
      }
    }
  }
  return last as DashboardSettingsPayload;
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
