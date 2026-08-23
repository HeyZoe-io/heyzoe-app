import { AsyncLocalStorage } from "node:async_hooks";

export type WaMessageLogScope = {
  businessSlug: string;
  sessionId: string;
  depth: number;
  pendingOutbound: string[];
  loggedUser: string[];
  loggedAssistant: string[];
};

const als = new AsyncLocalStorage<WaMessageLogScope>();

export function normalizeWaLogContent(content: string): string {
  return String(content ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Exact match, containment (min 16 chars), or shared prefix (48 chars) — same send logged with extra footer/buttons. */
export function waOutboundLogMatches(a: string, b: string): boolean {
  const x = normalizeWaLogContent(a);
  const y = normalizeWaLogContent(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 16 && y.length >= 16 && (x.includes(y) || y.includes(x))) return true;
  const n = 48;
  return x.length >= n && y.length >= n && x.slice(0, n) === y.slice(0, n);
}

function newScope(businessSlug: string, sessionId: string): WaMessageLogScope {
  return {
    businessSlug: businessSlug.trim().toLowerCase(),
    sessionId: sessionId.trim(),
    depth: 1,
    pendingOutbound: [],
    loggedUser: [],
    loggedAssistant: [],
  };
}

export function getWaMessageLogScope(): WaMessageLogScope | undefined {
  return als.getStore();
}

export function beginWaMessageLogScope(input: { businessSlug: string; sessionId: string }): void {
  const slug = String(input.businessSlug ?? "")
    .trim()
    .toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  if (!slug || !sessionId) return;
  const existing = als.getStore();
  if (existing) {
    if (existing.businessSlug === slug && existing.sessionId === sessionId) {
      existing.depth += 1;
      return;
    }
    console.warn("[wa-message-log] nested scope mismatch — reusing parent", {
      parent_slug: existing.businessSlug,
      parent_session: existing.sessionId,
      child_slug: slug,
      child_session: sessionId,
    });
    existing.depth += 1;
    return;
  }
  als.enterWith(newScope(slug, sessionId));
}

export async function withWaMessageLogScope<T>(
  input: { businessSlug: string; sessionId: string },
  fn: () => Promise<T>
): Promise<T> {
  beginWaMessageLogScope(input);
  try {
    return await fn();
  } finally {
    await endWaMessageLogScope();
  }
}

export function recordWaOutboundSent(content: string): void {
  const store = als.getStore();
  if (!store) return;
  const text = String(content ?? "").trim();
  if (!text) return;
  if (store.loggedAssistant.some((logged) => waOutboundLogMatches(logged, text))) return;
  if (store.pendingOutbound.some((pending) => waOutboundLogMatches(pending, text))) return;
  store.pendingOutbound.push(text);
}

export function shouldSkipDuplicateWaLog(role: string, content: string): boolean {
  const store = als.getStore();
  if (!store) return false;
  const text = String(content ?? "").trim();
  if (!text) return false;
  if (role === "user") {
    const n = normalizeWaLogContent(text);
    return store.loggedUser.some((logged) => normalizeWaLogContent(logged) === n);
  }
  if (role === "assistant") {
    return store.loggedAssistant.some((logged) => waOutboundLogMatches(logged, text));
  }
  return false;
}

export function noteWaLogInserted(role: string, content: string): void {
  const store = als.getStore();
  if (!store) return;
  const text = String(content ?? "").trim();
  if (!text) return;
  if (role === "user") store.loggedUser.push(text);
  if (role === "assistant") store.loggedAssistant.push(text);
}

export function consumeWaOutboundIfLogged(content: string): void {
  const store = als.getStore();
  if (!store) return;
  const text = String(content ?? "").trim();
  if (!text) return;
  store.pendingOutbound = store.pendingOutbound.filter((pending) => !waOutboundLogMatches(pending, text));
}

export async function endWaMessageLogScope(): Promise<void> {
  const store = als.getStore();
  if (!store) return;
  store.depth -= 1;
  if (store.depth > 0) return;
  const leftover = store.pendingOutbound.splice(0);
  if (!leftover.length) return;
  const { logMessage } = await import("@/lib/analytics");
  for (const content of leftover) {
    const trimmed = content.trim();
    if (!trimmed) continue;
    if (store.loggedAssistant.some((logged) => waOutboundLogMatches(logged, trimmed))) continue;
    await logMessage({
      business_slug: store.businessSlug,
      role: "assistant",
      content: trimmed,
      model_used: "wa_outbound",
      session_id: store.sessionId,
    });
  }
}
