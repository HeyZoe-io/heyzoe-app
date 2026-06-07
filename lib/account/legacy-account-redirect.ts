import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAccountBusinessForUser } from "@/lib/account/resolve-business";

export const ACCOUNT_SECTIONS = [
  "settings",
  "billing",
  "notifications",
  "users",
  "contact",
] as const;

export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

export function accountSectionFromPathname(pathname: string): AccountSection {
  const parts = String(pathname ?? "")
    .split("/")
    .filter(Boolean);
  if (parts[0] !== "account") return "settings";
  const sec = parts[1] ?? "settings";
  return (ACCOUNT_SECTIONS as readonly string[]).includes(sec) ? (sec as AccountSection) : "settings";
}

export async function pathnameFromRequestHeaders(): Promise<string> {
  const h = await headers();
  const candidates = [
    h.get("next-url"),
    h.get("x-url"),
    h.get("x-middleware-request-url"),
    h.get("x-invoke-path"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      if (raw.startsWith("http")) return new URL(raw).pathname;
      if (raw.startsWith("/")) return raw.split("?")[0] ?? raw;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export async function searchFromRequestHeaders(): Promise<string> {
  const h = await headers();
  const candidates = [h.get("next-url"), h.get("x-url"), h.get("x-middleware-request-url")];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const url = raw.startsWith("http") ? new URL(raw) : new URL(raw, "https://heyzoe.io");
      const qs = url.search;
      if (qs) return qs;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export async function redirectLegacyAccountPath(section: AccountSection): Promise<never> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/dashboard/login");

  const ctx = await resolveAccountBusinessForUser(data.user.id);
  if (!ctx?.slug) redirect("/dashboard/login");

  const qs = await searchFromRequestHeaders();
  redirect(`/${encodeURIComponent(ctx.slug)}/account/${section}${qs}`);
}

export async function redirectLegacyAccountFromHeaders(): Promise<never> {
  const pathname = await pathnameFromRequestHeaders();
  const section = accountSectionFromPathname(pathname || "/account/settings");
  return redirectLegacyAccountPath(section);
}
