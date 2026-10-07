import { AsyncLocalStorage } from "node:async_hooks";
import { normalizeArboxPath, registerArboxCallHooks } from "@/lib/crm/arbox-call-counter-bridge";

type EndpointCounts = Map<string, number>;

type Bucket = {
  total: number;
  byEndpoint: EndpointCounts;
};

type Store = {
  cron: string;
  slug: string;
  emitIfEmpty: boolean;
  buckets: Map<string, Bucket>;
};

const storage = new AsyncLocalStorage<Store>();

function isPagedEndpoint(path: string): boolean {
  return (
    path.includes("/reports/") ||
    path === "/v3/schedule" ||
    path.startsWith("/v3/schedule/") ||
    path === "/v3/membershipTypes"
  );
}

function noteArboxCall(pathOrUrl: string): void {
  const store = storage.getStore();
  if (!store) return;
  const slug = store.slug.trim() || "unknown";
  let bucket = store.buckets.get(slug);
  if (!bucket) {
    bucket = { total: 0, byEndpoint: new Map() };
    store.buckets.set(slug, bucket);
  }
  const path = normalizeArboxPath(pathOrUrl);
  bucket.total += 1;
  bucket.byEndpoint.set(path, (bucket.byEndpoint.get(path) ?? 0) + 1);
}

export function setArboxCallCounterSlug(slug: string): void {
  const store = storage.getStore();
  if (!store) return;
  const next = String(slug ?? "").trim().toLowerCase();
  store.slug = next || "unknown";
}

function currentArboxCallSlug(): string | null {
  const slug = storage.getStore()?.slug?.trim() ?? "";
  if (!slug || slug === "pending") return null;
  return slug;
}

function writeSummary(cron: string, slug: string, total: number, byEndpoint: EndpointCounts): void {
  const by_endpoint: Record<string, number> = {};
  const pages: Record<string, number> = {};
  for (const [path, count] of [...byEndpoint.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    by_endpoint[path] = count;
    if (isPagedEndpoint(path)) pages[path] = count;
  }
  console.info(
    JSON.stringify({
      tag: "arbox_calls",
      cron,
      slug,
      total,
      by_endpoint,
      pages,
    })
  );
}

function emit(store: Store): void {
  if (store.buckets.size === 0) {
    if (!store.emitIfEmpty) return;
    writeSummary(store.cron, store.slug, 0, new Map());
    return;
  }
  for (const slug of [...store.buckets.keys()].sort()) {
    const bucket = store.buckets.get(slug);
    if (!bucket) continue;
    if (bucket.total === 0 && !store.emitIfEmpty) continue;
    writeSummary(store.cron, slug, bucket.total, bucket.byEndpoint);
  }
}

/**
 * One summary line per slug when the run finishes. Nested calls reuse the outer store
 * so a message that re-enters the handler is still one line.
 */
export async function runWithArboxCallCount<T>(
  opts: { cron: string; slug: string; emitIfEmpty?: boolean },
  fn: () => Promise<T>
): Promise<T> {
  if (storage.getStore()) return fn();
  const store: Store = {
    cron: opts.cron,
    slug: String(opts.slug ?? "").trim().toLowerCase() || "unknown",
    emitIfEmpty: opts.emitIfEmpty !== false,
    buckets: new Map(),
  };
  try {
    return await storage.run(store, fn);
  } finally {
    emit(store);
  }
}

registerArboxCallHooks({
  note: noteArboxCall,
  slug: currentArboxCallSlug,
});
