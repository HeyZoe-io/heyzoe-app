import type { SupabaseClient } from "@supabase/supabase-js";

const MUTATIONS = new Set(["insert", "upsert", "update", "delete"]);

/**
 * Reads pass through. insert/upsert/update/delete resolve as a no-op success
 * so dry_run can walk dedup reads without writing sync logs, contacts, or seed flags.
 */
export function dryRunSupabase(admin: SupabaseClient): SupabaseClient {
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => wrapBuilder(target.from(table));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as SupabaseClient;
}

function fakeMutation(): unknown {
  const payload = { data: [] as unknown[], error: null, count: 0, status: 200, statusText: "OK" };
  const promise = Promise.resolve(payload);
  const proxy: unknown = new Proxy(promise, {
    get(target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const fn = (target as Promise<unknown>)[prop as "then"];
        return typeof fn === "function" ? fn.bind(target) : undefined;
      }
      return () => proxy;
    },
  });
  return proxy;
}

function wrapBuilder(builder: unknown): unknown {
  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const fn = Reflect.get(target, prop, target);
        return typeof fn === "function" ? (fn as (...args: unknown[]) => unknown).bind(target) : undefined;
      }
      const value = Reflect.get(target, prop, target);
      if (typeof prop === "string" && MUTATIONS.has(prop) && typeof value === "function") {
        return () => fakeMutation();
      }
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (out === target) return receiver;
        return out;
      };
    },
  });
}
