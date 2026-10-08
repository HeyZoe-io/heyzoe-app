/**
 * POST /v3/tasks retry + audit row for the daily admin summary.
 * 8.10.2026 11:45: one 500 from Arbox lost a Tights handoff task. Notes are off and the studio
 * has human_requested alerts off, so staff got nothing until they read the chat 33 min later.
 *
 * Cost: a retry only after a 5xx / 429 / network error (rare): at most 2 extra Arbox POSTs.
 * A 5xx can still have created the task, so a retry may rarely open a second task;
 * a missing handoff is worse than a duplicate one.
 */
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";

export const ARBOX_TASK_RETRY_DELAYS_MS = [1_000, 3_000] as const;
export const CRM_TASK_FAILED_MODEL = "crm_task_create_failed";
export const CRM_TASK_AUDIT_SESSION = "crm-audit";

export function arboxTaskStatusIsRetryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

export async function postArboxTaskWithRetry(
  post: () => Promise<{ ok: boolean; status: number }>,
  opts: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {}
): Promise<{ ok: boolean; status: number; attempts: number }> {
  const delays = opts.delaysMs ?? ARBOX_TASK_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempts = 0;
  for (;;) {
    const res = await post();
    attempts += 1;
    if (res.ok) return { ok: true, status: res.status, attempts };
    const delay = delays[attempts - 1];
    if (delay == null || !arboxTaskStatusIsRetryable(res.status)) {
      return { ok: false, status: res.status, attempts };
    }
    console.warn("[crm/arbox] create task retry", { status: res.status, attempt: attempts, delay_ms: delay });
    await sleep(delay);
  }
}

export function renderCrmTaskFailureContent(input: {
  businessId: number | null;
  userId: string;
  taskTypeId: number;
  kind: string;
  status: number;
  attempts: number;
}): string {
  return `משימה בארבוקס לא נפתחה: עסק ${input.businessId ?? "?"} · ${input.kind} · משתמש ${input.userId} · סוג משימה ${input.taskTypeId} · סטטוס ${input.status} אחרי ${input.attempts} ניסיונות`;
}

/** One messages row (no Meta send) for the daily summary. Skipped in a dry run. Never throws. */
export async function recordArboxTaskFailure(input: {
  businessId: number | null;
  userId: string;
  taskTypeId: number;
  kind: string;
  status: number;
  attempts: number;
}): Promise<void> {
  if (isArboxDailyDryRun()) return;
  try {
    const [{ logMessage }, { MARKETING_CONVERSATIONS_SLUG }] = await Promise.all([
      import("@/lib/analytics"),
      import("@/lib/marketing-whatsapp"),
    ]);
    await logMessage({
      business_slug: MARKETING_CONVERSATIONS_SLUG,
      role: "assistant",
      content: renderCrmTaskFailureContent(input),
      model_used: input.businessId ? `${CRM_TASK_FAILED_MODEL}:${input.businessId}` : CRM_TASK_FAILED_MODEL,
      session_id: CRM_TASK_AUDIT_SESSION,
    });
  } catch (e) {
    console.error("[crm/arbox] task failure audit row failed:", e instanceof Error ? e.message : String(e));
  }
}
