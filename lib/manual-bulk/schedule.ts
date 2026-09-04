import { nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import { estimateManualBulkSendDurationMinutes } from "@/lib/manual-bulk/constants";

export type ManualBulkScheduleOk = {
  ok: true;
  dueAt: Date;
  dispatchAt: Date;
  windowAdjusted: boolean;
  scheduled: boolean;
};

export type ManualBulkScheduleErr = {
  ok: false;
  error: "schedule_in_past" | "invalid_schedule_time";
};

export type ManualBulkScheduleResult = ManualBulkScheduleOk | ManualBulkScheduleErr;

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** datetime-local / `YYYY-MM-DDTHH:mm` as Asia/Jerusalem wall time. */
export function parseIsraelWallDateTime(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = WALL_RE.exec(s);
  if (!m) return null;
  const ymd = `${m[1]}-${m[2]}-${m[3]}`;
  const hm = `${String(m[4]).padStart(2, "0")}:${m[5]}`;
  const due = israelWallTimeToUtc(ymd, hm);
  if (!Number.isFinite(due.getTime())) return null;
  return due;
}

/**
 * Enqueue due_at + the first tick the send-window guard will actually dispatch.
 * Omitted schedule → due_at = now (today's behavior). Guard still applies.
 */
export function resolveManualBulkSchedule(input: {
  scheduledAtRaw?: unknown;
  now?: Date;
}): ManualBulkScheduleResult {
  const now = input.now ?? new Date();
  const raw = input.scheduledAtRaw;
  const omitted = raw == null || String(raw).trim() === "";
  if (omitted) {
    const dispatchAt = nextAllowedWhatsAppSendTimeIsrael(now);
    return {
      ok: true,
      dueAt: now,
      dispatchAt,
      windowAdjusted: dispatchAt.getTime() > now.getTime(),
      scheduled: false,
    };
  }

  const dueAt = parseIsraelWallDateTime(raw);
  if (!dueAt) return { ok: false, error: "invalid_schedule_time" };
  if (dueAt.getTime() < now.getTime()) return { ok: false, error: "schedule_in_past" };

  const dispatchAt = nextAllowedWhatsAppSendTimeIsrael(dueAt);
  return {
    ok: true,
    dueAt,
    dispatchAt,
    windowAdjusted: dispatchAt.getTime() > dueAt.getTime(),
    scheduled: true,
  };
}

export function estimateManualBulkFinishAt(withPhoneCount: number, dispatchAt: Date): Date {
  const mins = estimateManualBulkSendDurationMinutes(withPhoneCount);
  return new Date(dispatchAt.getTime() + mins * 60 * 1000);
}

export function formatIsraelWallDateTimeHe(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function israelDatetimeLocalString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const min = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function scheduleSummaryJson(ok: ManualBulkScheduleOk, withPhoneCount: number) {
  const etaMinutes = estimateManualBulkSendDurationMinutes(withPhoneCount);
  const etaFinishAt = estimateManualBulkFinishAt(withPhoneCount, ok.dispatchAt);
  return {
    due_at: ok.dueAt.toISOString(),
    dispatch_at: ok.dispatchAt.toISOString(),
    eta_finish_at: etaFinishAt.toISOString(),
    eta_minutes: etaMinutes,
    window_adjusted: ok.windowAdjusted,
    scheduled: ok.scheduled,
    due_at_he: formatIsraelWallDateTimeHe(ok.dueAt),
    dispatch_at_he: formatIsraelWallDateTimeHe(ok.dispatchAt),
    eta_finish_at_he: formatIsraelWallDateTimeHe(etaFinishAt),
  };
}
