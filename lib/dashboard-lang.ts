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
