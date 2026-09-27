/** Prefixes that are never a business slug in `/{slug}/…` dashboard URLs. */
const RESERVED_FIRST_SEGMENTS = new Set([
  "account",
  "admin",
  "api",
  "contact",
  "dashboard",
  "lp-leads",
  "onboarding",
  "privacy",
  "register",
  "templates",
  "terms",
]);

/**
 * Parse `/{slug}/analytics` (and similar) from a same-origin `next` path.
 * Reserved first segments are not treated as business slugs.
 */
export function parseOwnerDashboardPath(
  pathWithSearch: string
): { slug: string; rest: string } | null {
  const raw = String(pathWithSearch ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;

  let pathname = raw;
  let search = "";
  const q = raw.indexOf("?");
  if (q >= 0) {
    pathname = raw.slice(0, q);
    search = raw.slice(q);
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  let slug = parts[0] ?? "";
  try {
    slug = decodeURIComponent(slug).trim().toLowerCase();
  } catch {
    slug = slug.trim().toLowerCase();
  }
  if (!slug || RESERVED_FIRST_SEGMENTS.has(slug)) return null;

  const after = parts.slice(1).join("/");
  const restPath = after ? `/${after}` : "/analytics";
  return { slug, rest: `${restPath}${search}` };
}

export function preferredDashboardHref(ownSlug: string, rest: string): string {
  const slug = String(ownSlug ?? "").trim();
  const suffix = rest.startsWith("/") ? rest : `/${rest}`;
  return `/${encodeURIComponent(slug)}${suffix}`;
}

/** Keep `utm_*` (and any other query) on a same-origin path such as `/templates`. */
export function appendPageSearch(
  path: string,
  searchParams: Record<string, string | string[] | undefined>
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      sp.append(key, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") sp.append(key, item);
      }
    }
  }
  const q = sp.toString();
  if (!q) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${q}`;
}
