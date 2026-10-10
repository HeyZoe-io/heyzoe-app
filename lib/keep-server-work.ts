import { after } from "next/server";

export type ServerWorkSchedule = (task: () => Promise<void>) => void;

export function scheduleWithAfter(task: () => Promise<void>): void {
  after(task);
}

/**
 * A send or write that must finish after the HTTP response.
 * `after()` keeps the serverless invocation alive. Failures are logged and do not throw.
 */
export function keepServerWork(
  label: string,
  work: Promise<unknown>,
  schedule: ServerWorkSchedule = scheduleWithAfter
): void {
  const guarded = work.then(
    () => undefined,
    (error: unknown) => {
      console.error(`[keep] ${label} failed:`, error instanceof Error ? error.message : String(error));
    }
  );
  try {
    schedule(() => guarded);
  } catch (error) {
    console.error(
      `[keep] ${label} was not scheduled:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}
