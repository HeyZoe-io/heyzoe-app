import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Opt-in context for one /api/cron/arbox-daily-triggers/business invocation.
 * Unset for every other Arbox caller, so their fetch/send behavior is unchanged.
 */
export type ArboxDailyRunContext = {
  businessId: number;
  dryRun: boolean;
  /** Per-request AbortSignal timeout applied only while this context is active. */
  timeoutMs: number;
  arboxCalls: number;
  arboxReports: string[];
  /** In-flight /v3/membershipTypes result, keyed by API key. One fetch per run. */
  membershipTypesByKey: Map<string, Promise<unknown>>;
};

const storage = new AsyncLocalStorage<ArboxDailyRunContext>();

export function arboxDailyContext(): ArboxDailyRunContext | undefined {
  return storage.getStore();
}

export function isArboxDailyDryRun(): boolean {
  return storage.getStore()?.dryRun === true;
}

export function runArboxDailyContext<T>(
  ctx: ArboxDailyRunContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(ctx, fn);
}
