/**
 * Client-safe Arbox fetch side effects. No node:async_hooks import: dashboard
 * and template client components import the Arbox adapter. The server counter
 * registers the note hook and the slug reader when its module loads.
 */
export type ArboxFailureLog = {
  pathOrUrl: string;
  status: number;
  json: unknown;
  durationMs: number;
};

type Hooks = {
  note?: (pathOrUrl: string) => void;
  slug?: () => string | null;
};

function hooks(): Hooks {
  const g = globalThis as { __hzArboxCallHooks?: Hooks };
  if (!g.__hzArboxCallHooks) g.__hzArboxCallHooks = {};
  return g.__hzArboxCallHooks;
}

export function registerArboxCallHooks(next: Hooks): void {
  const current = hooks();
  if (next.note) current.note = next.note;
  if (next.slug) current.slug = next.slug;
}

/** Path only. Query strings (phone, email) are dropped. Numeric segments become {id}. */
export function normalizeArboxPath(pathOrUrl: string): string {
  let path = String(pathOrUrl ?? "").trim();
  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      path = new URL(path).pathname;
    }
  } catch {
    // Keep the raw path and still strip any query below.
  }
  const query = path.indexOf("?");
  if (query >= 0) path = path.slice(0, query);
  const hash = path.indexOf("#");
  if (hash >= 0) path = path.slice(0, hash);
  const marker = "/api/public";
  const at = path.indexOf(marker);
  if (at >= 0) path = path.slice(at + marker.length);
  if (!path.startsWith("/")) path = `/${path}`;
  const normalized = path
    .split("/")
    .map((seg) => (/^\d+$/.test(seg) ? "{id}" : seg))
    .join("/")
    .replace(/\/+$/, "");
  return normalized || "/";
}

function shortArboxError(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  for (const key of ["message", "error", "err", "error_message", "code"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    if (/@|\d{7,}/.test(text)) return "redacted";
    return text.slice(0, 120);
  }
  const statusCode = record.statusCode;
  if (typeof statusCode === "number" || typeof statusCode === "string") {
    const text = String(statusCode).trim();
    if (text) return text.slice(0, 120);
  }
  return null;
}

export function noteArboxCall(pathOrUrl: string): void {
  hooks().note?.(pathOrUrl);
}

/** Failure log only. Never includes the response body, the request body, or the API key. */
export function logArboxPublicFailure(input: ArboxFailureLog): void {
  console.error(
    JSON.stringify({
      tag: "arbox_error",
      path: normalizeArboxPath(input.pathOrUrl),
      status: input.status,
      error: shortArboxError(input.json),
      slug: hooks().slug?.() ?? null,
      duration_ms: input.durationMs,
    })
  );
}
