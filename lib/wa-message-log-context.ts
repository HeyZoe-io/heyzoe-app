type AlsLike<T> = {
  getStore: () => T | undefined;
  enterWith: (value: T) => void;
  run: <R>(store: T, fn: () => Promise<R>) => Promise<R>;
};

export type WaMessageLogScope = {
  businessSlug: string;
  sessionId: string;
  depth: number;
  pendingOutbound: string[];
  loggedUser: string[];
  loggedAssistant: string[];
};

const NOOP_ALS: AlsLike<WaMessageLogScope> = {
  getStore: () => undefined,
  enterWith: () => {},
  run: async (_store, fn) => fn(),
};

/** Installed by `wa-message-log-als.server.ts` on the WhatsApp server runtime. */
function getAls(): AlsLike<WaMessageLogScope> {
  return (
    (globalThis as { __hzWaMessageLogAls?: AlsLike<WaMessageLogScope> }).__hzWaMessageLogAls ?? NOOP_ALS
  );
}

export function normalizeWaLogContent(content: string): string {
  return String(content ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Dashboard log adds `[כפתורים: …]` — the Meta send body does not. */
function stripWaLogDecorations(raw: string): string {
  return normalizeWaLogContent(
    String(raw ?? "")
      .replace(/\n*\[[^\]]{0,80}:[^\]]*\]/g, "")
      .replace(/\n*_לביטול קבלת הודעות שלח \*הסר\*_/g, "")
  );
}

/** Exact match, containment (min 16 chars), or shared prefix (48 chars) — same send logged with extra footer/buttons. */
export function waOutboundLogMatches(a: string, b: string): boolean {
  const x = stripWaLogDecorations(a);
  const y = stripWaLogDecorations(b);
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
  return getAls().getStore();
}

function parseScopeInput(input: { businessSlug: string; sessionId: string }): {
  slug: string;
  sessionId: string;
} | null {
  const slug = String(input.businessSlug ?? "")
    .trim()
    .toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  if (!slug || !sessionId) return null;
  return { slug, sessionId };
}

/**
 * Sequential tests / legacy callers. Concurrent requests must use `withWaMessageLogScope`
 * (`AsyncLocalStorage.run`) — `enterWith` is not request-isolated.
 */
export function beginWaMessageLogScope(input: { businessSlug: string; sessionId: string }): void {
  const parsed = parseScopeInput(input);
  if (!parsed) return;
  const existing = getAls().getStore();
  if (existing) {
    if (existing.businessSlug === parsed.slug && existing.sessionId === parsed.sessionId) {
      existing.depth += 1;
      return;
    }
    console.warn("[wa-message-log] nested scope mismatch — not reusing parent", {
      parent_slug: existing.businessSlug,
      parent_session: existing.sessionId,
      child_slug: parsed.slug,
      child_session: parsed.sessionId,
    });
  }
  getAls().enterWith(newScope(parsed.slug, parsed.sessionId));
}

export async function withWaMessageLogScope<T>(
  input: { businessSlug: string; sessionId: string },
  fn: () => Promise<T>
): Promise<T> {
  const parsed = parseScopeInput(input);
  if (!parsed) return await fn();
  const parent = getAls().getStore();
  if (parent && parent.businessSlug === parsed.slug && parent.sessionId === parsed.sessionId) {
    parent.depth += 1;
    try {
      return await fn();
    } finally {
      await endWaMessageLogScope();
    }
  }
  return await getAls().run(newScope(parsed.slug, parsed.sessionId), async () => {
    try {
      return await fn();
    } finally {
      await endWaMessageLogScope();
    }
  });
}

export function recordWaOutboundSent(content: string): void {
  const store = getAls().getStore();
  if (!store) return;
  const text = String(content ?? "").trim();
  if (!text) return;
  if (store.loggedAssistant.some((logged) => waOutboundLogMatches(logged, text))) return;
  if (store.pendingOutbound.some((pending) => waOutboundLogMatches(pending, text))) return;
  store.pendingOutbound.push(text);
}

if (typeof window === "undefined") {
  (globalThis as { __hzRecordWaOutboundSent?: (s: string) => void }).__hzRecordWaOutboundSent =
    recordWaOutboundSent;
}

export function shouldSkipDuplicateWaLog(role: string, content: string): boolean {
  const store = getAls().getStore();
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
  const store = getAls().getStore();
  if (!store) return;
  const text = String(content ?? "").trim();
  if (!text) return;
  if (role === "user") store.loggedUser.push(text);
  if (role === "assistant") store.loggedAssistant.push(text);
}

export function consumeWaOutboundIfLogged(content: string): void {
  const store = getAls().getStore();
  if (!store) return;
  const text = String(content ?? "").trim();
  if (!text) return;
  store.pendingOutbound = store.pendingOutbound.filter((pending) => !waOutboundLogMatches(pending, text));
}

export async function endWaMessageLogScope(): Promise<void> {
  const store = getAls().getStore();
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
