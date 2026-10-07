import { AsyncLocalStorage } from "node:async_hooks";
import type { StaffIndex } from "@/lib/leads/arbox-staff";

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
  /** Morning roster from GET /v3/users/allStaffMembers. Unset on a failed fetch. */
  staffIndex?: StaffIndex;
  /** Filled only while dryRun is true. Returned to the caller; nothing is sent. */
  wouldSend?: { template: string; phone_tail: string; params: string[] }[];
};

const storage = new AsyncLocalStorage<ArboxDailyRunContext>();

type ArboxDailyBridge = {
  context: () => ArboxDailyRunContext | undefined;
  isDryRun: () => boolean;
};

const bridge: ArboxDailyBridge = {
  context: () => storage.getStore(),
  isDryRun: () => storage.getStore()?.dryRun === true,
};

(globalThis as { __hzArboxDaily?: ArboxDailyBridge }).__hzArboxDaily = bridge;

export function arboxDailyContext(): ArboxDailyRunContext | undefined {
  return bridge.context();
}

export function isArboxDailyDryRun(): boolean {
  return bridge.isDryRun();
}

export function runArboxDailyContext<T>(
  ctx: ArboxDailyRunContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(ctx, fn);
}
