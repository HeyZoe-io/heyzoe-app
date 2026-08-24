import { AsyncLocalStorage } from "node:async_hooks";
import type { WaMessageLogScope } from "@/lib/wa-message-log-context";

const storage = new AsyncLocalStorage<WaMessageLogScope>();

(
  globalThis as {
    __hzWaMessageLogAls?: {
      getStore: () => WaMessageLogScope | undefined;
      enterWith: (value: WaMessageLogScope) => void;
      run: <R>(store: WaMessageLogScope, fn: () => Promise<R>) => Promise<R>;
    };
  }
).__hzWaMessageLogAls = {
  getStore: () => storage.getStore(),
  enterWith: (value) => storage.enterWith(value),
  run: (store, fn) => storage.run(store, fn),
};
