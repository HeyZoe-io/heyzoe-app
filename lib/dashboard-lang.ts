export type DashboardLang = "he" | "en";

export function dashboardLangFromParam(raw: string | null | undefined): DashboardLang {
  return String(raw ?? "").trim().toLowerCase() === "en" ? "en" : "he";
}

export function dashboardDir(lang: DashboardLang): "rtl" | "ltr" {
  return lang === "en" ? "ltr" : "rtl";
}

export function dashboardTextAlign(lang: DashboardLang): "right" | "left" {
  return lang === "en" ? "left" : "right";
}

export function dashboardDateLocale(lang: DashboardLang): string {
  return lang === "en" ? "en-US" : "he-IL";
}

/** Build a dashboard path preserving `?lang=en` when active. */
export function dashboardHref(
  pathname: string,
  lang: DashboardLang,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  const q = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      const s = String(value).trim();
      if (!s) continue;
      q.set(key, s);
    }
  }
  if (lang === "en") q.set("lang", "en");
  const qs = q.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
