import { createHmac, timingSafeEqual } from "node:crypto";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import { resolveMarketingAdminColumn, type MarketingAdminColumn } from "@/lib/marketing-admin-status";
import { toPipelineDateOnly, toPipelineTime } from "@/lib/marketing-next-call";
import { normalizePhone } from "@/lib/phone-normalize";
import { resolveCronSecret } from "@/lib/server-env";
import type { LeadRow } from "@/lib/leads-types";

/** אורך פגישת שיחה ביומן. אין שדה משך בפייפליין. */
export const ZOE_ADMIN_CALL_DURATION_MS = 30 * 60 * 1000;

const CALENDAR_COLUMNS = new Set<MarketingAdminColumn>(["setup_call", "requires_call"]);

export type ZoeAdminCalendarEvent = {
  uid: string;
  title: string;
  location: string;
  startUtc: Date;
  endUtc: Date;
};

export function zoeAdminCalendarFeedToken(): string {
  const dedicated = process.env.ZOE_ADMIN_CALENDAR_TOKEN?.trim() ?? "";
  if (dedicated) return dedicated;
  const secret = resolveCronSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update("zoe-admin-calendar-v1").digest("hex");
}

export function authorizeZoeAdminCalendarToken(token: string | null | undefined): boolean {
  const expected = zoeAdminCalendarFeedToken();
  const given = String(token ?? "");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** מספר מקומי לחיוג, לשדה המיקום ביומן. */
export function zoeAdminCalendarLocation(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  if (normalized) return `0${normalized.slice(3)}`;
  const raw = String(phone ?? "").trim();
  return raw || null;
}

export function zoeAdminCalendarTitle(column: "setup_call" | "requires_call", fullName: string | null | undefined): string {
  const label = column === "setup_call" ? "שיחת הקמה" : "דורש שיחה";
  const name = String(fullName ?? "").trim() || "לקוח";
  return `${label} (${name}) - זואי`;
}

export function zoeAdminCalendarEventFromLead(row: LeadRow): ZoeAdminCalendarEvent | null {
  const column = resolveMarketingAdminColumn(row);
  if (!CALENDAR_COLUMNS.has(column)) return null;
  const dateYmd = toPipelineDateOnly(row.next_call_at);
  const timeHm = toPipelineTime(row.next_call_time);
  const location = zoeAdminCalendarLocation(row.phone);
  if (!dateYmd || !timeHm || !location || !row.phone) return null;
  const startUtc = israelWallTimeToUtc(dateYmd, timeHm);
  if (!Number.isFinite(startUtc.getTime())) return null;
  const digits = normalizePhone(row.phone) ?? String(row.phone).replace(/\D/g, "");
  if (!digits) return null;
  return {
    uid: `zoe-admin-${digits}@heyzoe.io`,
    title: zoeAdminCalendarTitle(column, row.full_name),
    location,
    startUtc,
    endUtc: new Date(startUtc.getTime() + ZOE_ADMIN_CALL_DURATION_MS),
  };
}

function formatUtcIcs(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + limit);
    while (end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
    if (end === start) end = Math.min(bytes.length, start + limit);
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return parts.map((part, i) => (i === 0 ? part : ` ${part}`)).join("\r\n");
}

export function buildZoeAdminCalendarIcs(events: ZoeAdminCalendarEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HeyZoe//Zoe Admin//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:שיחות זואי אדמין",
    "X-WR-TIMEZONE:Asia/Jerusalem",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const sorted = [...events].sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  const stamp = formatUtcIcs(now);
  for (const event of sorted) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatUtcIcs(event.startUtc)}`,
      `DTEND:${formatUtcIcs(event.endUtc)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      `LOCATION:${escapeIcsText(event.location)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:שיחה",
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
