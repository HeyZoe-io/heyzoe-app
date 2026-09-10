import { normDashboardSlug } from "@/lib/dashboard-business-access";

/** slug מה־query או מה־body — בלי fallback לעסק אחר. */
export function parseAccountUsersSlug(searchParams: URLSearchParams, body?: unknown): string {
  const fromQuery = searchParams.get("slug");
  if (typeof fromQuery === "string" && fromQuery.trim()) {
    return normDashboardSlug(fromQuery);
  }
  if (body && typeof body === "object" && typeof (body as { slug?: unknown }).slug === "string") {
    return normDashboardSlug((body as { slug: string }).slug);
  }
  return "";
}

export function canManageAccountUsers(opts: {
  isPlatformAdmin: boolean;
  membershipRole?: string | null;
}): boolean {
  if (opts.isPlatformAdmin) return true;
  return opts.membershipRole === "admin";
}
