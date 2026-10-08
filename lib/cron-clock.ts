import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logMessage } from "@/lib/analytics";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { MARKETING_CONVERSATIONS_SLUG } from "@/lib/marketing-whatsapp";
import { resolveCronSecret } from "@/lib/server-env";

/** Query keys that would replace the server clock. None of these are read on a live run. */
export const CRON_TIME_OVERRIDE_PARAMS = ["now", "date", "today", "at", "as_of", "asof"] as const;

export const CRON_UNEXPECTED_CALLER_MODEL = "cron_unexpected_caller";
export const CRON_INTERNAL_HEADER = "x-heyzoe-cron-internal";

const CRON_JOB_ORG_UA = /cron-job\.org/i;
const VERCEL_CRON_UA = /^vercel-cron\/\d/i;

/** Paths under `crons` in vercel.json. cron-clock.test.ts fails if the two drift apart. */
export const VERCEL_CRON_ROUTES: readonly string[] = ["/api/cron/reset-monthly-quota-warnings"];

export type CronTimeOverrideDecision =
  | { action: "none" }
  | { action: "reject"; error: "time_override_requires_dry_run" | "invalid_time_override" }
  | { action: "use"; now: Date };

function firstParam(params: URLSearchParams, names: readonly string[]): string | null {
  for (const name of names) {
    const value = params.get(name);
    if (value != null && value.trim()) return value.trim();
  }
  return null;
}

/** `date` / `today` are the 09:00 Asia/Jerusalem morning slot of that calendar day. */
export function israelMorningInstant(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  for (const offset of ["+02:00", "+03:00"]) {
    const dt = new Date(`${ymd}T09:00:00${offset}`);
    if (Number.isNaN(dt.getTime())) continue;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    if (`${get("year")}-${get("month")}-${get("day")}` === ymd && hour === "09" && get("minute") === "00") {
      return dt;
    }
  }
  return null;
}

export function cronTimeOverrideDecision(params: URLSearchParams): CronTimeOverrideDecision {
  const present = CRON_TIME_OVERRIDE_PARAMS.some((name) => params.has(name));
  if (!present) return { action: "none" };
  if (params.get("dry_run") !== "1") return { action: "reject", error: "time_override_requires_dry_run" };
  const instant = firstParam(params, ["now", "at", "as_of", "asof"]);
  if (instant) {
    const dt = new Date(instant);
    if (Number.isNaN(dt.getTime())) return { action: "reject", error: "invalid_time_override" };
    return { action: "use", now: dt };
  }
  const day = firstParam(params, ["date", "today"]);
  const morning = day ? israelMorningInstant(day) : null;
  if (!morning) return { action: "reject", error: "invalid_time_override" };
  return { action: "use", now: morning };
}

export function rejectCronTimeOverride(req: NextRequest, allowDryRun = false): NextResponse | null {
  const params = req.nextUrl.searchParams;
  const present = CRON_TIME_OVERRIDE_PARAMS.some((name) => params.has(name));
  if (!present) return null;
  if (params.get("dry_run") !== "1") {
    return NextResponse.json({ error: "time_override_requires_dry_run" }, { status: 400 });
  }
  if (!allowDryRun) {
    return NextResponse.json({ error: "time_override_not_supported" }, { status: 400 });
  }
  const decision = cronTimeOverrideDecision(params);
  if (decision.action === "reject") {
    return NextResponse.json({ error: decision.error }, { status: 400 });
  }
  return null;
}

export function cronDryRunNow(req: NextRequest): Date | undefined {
  const decision = cronTimeOverrideDecision(req.nextUrl.searchParams);
  return decision.action === "use" ? decision.now : undefined;
}

/**
 * Live runs always use the server clock. A supplied `now` is the dry-run preview clock only.
 * Anything else does no work, so a local script cannot send with Thursday's clock on Wednesday.
 */
export function resolveCronNow(
  supplied: Date | undefined,
  dryRun: boolean,
  realNow: Date = new Date()
): { ok: true; now: Date } | { ok: false; error: "time_override_requires_dry_run" } {
  if (!supplied || Math.abs(supplied.getTime() - realNow.getTime()) <= 2_000) {
    return { ok: true, now: realNow };
  }
  if (!dryRun) return { ok: false, error: "time_override_requires_dry_run" };
  return { ok: true, now: supplied };
}

export function isCronJobOrgUserAgent(userAgent: string | null | undefined): boolean {
  return CRON_JOB_ORG_UA.test(String(userAgent ?? ""));
}

/**
 * A scheduled run from vercel.json: listed route, Vercel's cron user agent, and the
 * `Bearer CRON_SECRET` header Vercel attaches. All three, or it is still flagged.
 */
export function isVercelScheduledCron(input: {
  route: string;
  userAgent: string | null | undefined;
  authorization: string | null | undefined;
  secret: string;
}): boolean {
  if (!input.secret) return false;
  if (!VERCEL_CRON_ROUTES.includes(input.route)) return false;
  if (!VERCEL_CRON_UA.test(String(input.userAgent ?? "").trim())) return false;
  return input.authorization === `Bearer ${input.secret}`;
}

export function isInternalCronCall(req: NextRequest): boolean {
  return req.headers.get(CRON_INTERNAL_HEADER) === "1";
}

export function logCronInvocation(input: {
  route: string;
  slot?: string | null;
  userAgent: string | null;
  dryRun: boolean;
  sends: number | null;
}): void {
  console.info("[cron] invoke", {
    route: input.route,
    slot: input.slot ?? null,
    user_agent: input.userAgent ?? "",
    dry_run: input.dryRun,
    sends: input.sends,
  });
}

/** One messages row for the daily admin summary. No Meta send. Skipped entirely during a dry run. */
export async function noteUnexpectedCronCaller(input: {
  route: string;
  slot?: string | null;
  userAgent: string | null;
  dryRun: boolean;
  internal: boolean;
  vercelCron?: boolean;
}): Promise<void> {
  if (input.dryRun || input.internal || input.vercelCron || isCronJobOrgUserAgent(input.userAgent)) return;
  if (isArboxDailyDryRun()) return;
  const ua = String(input.userAgent ?? "").trim() || "חסר";
  const slot = input.slot ? ` slot=${input.slot}` : "";
  await logMessage({
    business_slug: MARKETING_CONVERSATIONS_SLUG,
    role: "assistant",
    content: `קרון לא מ-cron-job.org: ${input.route}${slot} ua=${ua}`,
    model_used: CRON_UNEXPECTED_CALLER_MODEL,
    session_id: "cron-audit",
  });
}

export async function acknowledgeCron(
  req: NextRequest,
  route: string,
  sends: number | null = null
): Promise<void> {
  const dryRun =
    req.nextUrl.searchParams.get("dry_run") === "1" ||
    (route.endsWith("/arbox-class-cancel-notify") &&
      process.env.CLASS_CANCEL_NOTIFY_DRY_RUN === "1");
  const slot = req.nextUrl.searchParams.get("slot");
  const userAgent = req.headers.get("user-agent");
  logCronInvocation({ route, slot, userAgent, dryRun, sends });
  await noteUnexpectedCronCaller({
    route,
    slot,
    userAgent,
    dryRun,
    internal: isInternalCronCall(req),
    vercelCron: isVercelScheduledCron({
      route,
      userAgent,
      authorization: req.headers.get("authorization"),
      secret: resolveCronSecret(),
    }),
  });
}

export function countNotifiedSends(summary: unknown): number {
  if (!summary || typeof summary !== "object") return 0;
  let total = 0;
  for (const value of Object.values(summary as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || !("notified" in value)) continue;
    const notified = Number((value as { notified?: unknown }).notified);
    if (Number.isFinite(notified)) total += notified;
  }
  return total;
}
