/**
 * Read the daily-triggers context without importing node:async_hooks.
 * The worker route installs the bridge. Client bundles and every other caller
 * see no context, so send/fetch behavior stays unchanged.
 */
type ArboxDailyRunContext = {
  businessId: number;
  dryRun: boolean;
  timeoutMs: number;
  arboxCalls: number;
  arboxReports: string[];
  membershipTypesByKey: Map<string, Promise<unknown>>;
};

type ArboxDailyBridge = {
  context: () => ArboxDailyRunContext | undefined;
  isDryRun: () => boolean;
};

function bridge(): ArboxDailyBridge | undefined {
  return (globalThis as { __hzArboxDaily?: ArboxDailyBridge }).__hzArboxDaily;
}

export function arboxDailyContext(): ArboxDailyRunContext | undefined {
  return bridge()?.context();
}

export function isArboxDailyDryRun(): boolean {
  return bridge()?.isDryRun() === true;
}
