/**
 * Read-only Arbox schedule lookup by phone — on-demand, explicit schedule_inquiry only.
 * Reuses GET /v3/reports/bookingsReport (same path as the daily trial-attended cron).
 * No Arbox writes. No cache. Scheduling is not attached to the inbound webhook broadly.
 *
 * IO (10x clients): 1–20 bookingsReport pages + 0–1 searchUser, only when the lead
 * explicitly asks about their bookings (never per inbound message).
 */

import { searchArboxUserByPhone } from "@/lib/crm/adapters/arbox";
import { canUseArboxScheduleLookup } from "@/lib/crm/types";
import {
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { contactPhoneLookupVariants, normalizeIsraeliPhoneTail } from "@/lib/phone-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const ISRAEL_TZ = "Asia/Jerusalem";
const HEBREW_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;
const LOOKAHEAD_DAYS = 14;

export const SCHEDULE_LOOKUP_SINGLE_MODEL = "schedule_lookup_single";
export const SCHEDULE_LOOKUP_MULTIPLE_MODEL = "schedule_lookup_multiple";
export const SCHEDULE_LOOKUP_NO_BOOKINGS_MODEL = "schedule_lookup_no_bookings";
export const SCHEDULE_LOOKUP_PHONE_NOT_FOUND_MODEL = "schedule_lookup_phone_not_found";
export const SCHEDULE_LOOKUP_RETRY_HANDOFF_MODEL = "schedule_lookup_retry_handoff";
export const SCHEDULE_LOOKUP_FETCH_FAILED_MODEL = "schedule_lookup_fetch_failed";

export const SCHEDULE_LOOKUP_PHONE_NOT_FOUND_SNIPPET = "לא מצאתי את המספר הזה במערכת שלנו";

export type ScheduleLookupBooking = {
  className: string;
  dateYmd: string;
  timeHhmm: string | null;
  sortKey: string;
};

export type ScheduleLookupReplyKind = "single" | "multiple" | "no_bookings" | "phone_not_found" | "retry_handoff" | "fetch_failed";

export type ScheduleLookupReply = {
  kind: ScheduleLookupReplyKind;
  text: string;
  modelUsed: string;
  notifyHumanRequested: boolean;
};

function parsePositiveIntId(value: string | null | undefined): number | null {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const utc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function scheduleLookupWindow(now: Date = new Date()): { fromDate: string; toDate: string } {
  const fromDate = formatDateYmdIsrael(now);
  return { fromDate, toDate: addDaysToYmd(fromDate, LOOKAHEAD_DAYS) };
}

export function isScheduleLookupPhoneNotFoundOutbound(input: {
  modelUsed?: string | null;
  content?: string | null;
}): boolean {
  if (String(input.modelUsed ?? "").trim() === SCHEDULE_LOOKUP_PHONE_NOT_FOUND_MODEL) return true;
  return String(input.content ?? "").includes(SCHEDULE_LOOKUP_PHONE_NOT_FOUND_SNIPPET);
}

/** 4d (number not in system) or 4c (no bookings on that number) → inbound phone → one retry. */
export function shouldTreatInboundAsScheduleLookupRetry(input: {
  lastModelUsed?: string | null;
  lastAssistantContent?: string | null;
  inboundText: string;
}): boolean {
  if (normalizeIsraeliPhoneTail(input.inboundText) == null) return false;
  const model = String(input.lastModelUsed ?? "").trim();
  if (model === SCHEDULE_LOOKUP_PHONE_NOT_FOUND_MODEL) return true;
  if (model === SCHEDULE_LOOKUP_NO_BOOKINGS_MODEL) return true;
  return isScheduleLookupPhoneNotFoundOutbound({
    modelUsed: input.lastModelUsed,
    content: input.lastAssistantContent,
  });
}

export function hebrewDayFromYmd(ymd: string): string {
  const parsed = parseClassDateYmd(ymd);
  if (!parsed) return "";
  const [y, m, d] = parsed.split("-").map((n) => Number(n));
  const utc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TZ,
    weekday: "short",
  }).format(utc);
  const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekdayName] ?? 0;
  return HEBREW_WEEKDAYS[idx] ?? "";
}

/** Display date as DD.M (no leading zeros), e.g. 25.8 */
export function formatScheduleLookupDate(ymd: string): string {
  const parsed = parseClassDateYmd(ymd);
  if (!parsed) return "";
  const [, m, d] = parsed.split("-").map((n) => Number(n));
  if (!m || !d) return "";
  return `${d}.${m}`;
}

export function formatScheduleLookupTime(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = /(?:^|[^\d])(\d{1,2}):([0-5]\d)(?::[0-5]\d)?/.exec(` ${s}`);
  if (!m) {
    const iso = /T(\d{2}):(\d{2})/.exec(s);
    if (!iso) return null;
    return `${iso[1]}:${iso[2]}`;
  }
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

function bookingPhoneFields(row: ArboxBookingReportRow): unknown[] {
  const extra = row as ArboxBookingReportRow & { additional_phone?: unknown; mobile?: unknown; user_phone?: unknown };
  return [row.phone, extra.additional_phone, extra.mobile, extra.user_phone];
}

export function bookingMatchesPhoneTail(row: ArboxBookingReportRow, phoneTail: string): boolean {
  if (!phoneTail) return false;
  for (const field of bookingPhoneFields(row)) {
    const tail = normalizeIsraeliPhoneTail(field);
    if (tail && tail === phoneTail) return true;
  }
  return false;
}

export function bookingMatchesUserId(row: ArboxBookingReportRow, userId: string): boolean {
  const id = String(row.user_id ?? "").trim();
  return Boolean(userId) && id === userId;
}

function parseBookingSortParts(row: ArboxBookingReportRow): { dateYmd: string; timeHhmm: string | null } | null {
  const dateRaw = String(row.date ?? "").trim();
  const dateYmd = parseClassDateYmd(dateRaw);
  if (!dateYmd) return null;
  const fromTimeField = formatScheduleLookupTime(row.time);
  const fromDateIso = fromTimeField ? fromTimeField : formatScheduleLookupTime(dateRaw);
  return { dateYmd, timeHhmm: fromTimeField ?? fromDateIso };
}

export function mapBookingsForMember(
  rows: ArboxBookingReportRow[],
  input: { phoneTail: string; userId?: string | null }
): ScheduleLookupBooking[] {
  const userId = String(input.userId ?? "").trim();
  const out: ScheduleLookupBooking[] = [];
  for (const row of rows) {
    const phoneHit = bookingMatchesPhoneTail(row, input.phoneTail);
    const userHit = userId ? bookingMatchesUserId(row, userId) : false;
    if (!phoneHit && !userHit) continue;
    const parts = parseBookingSortParts(row);
    if (!parts) continue;
    const className = String(row.class_name ?? "").trim() || "שיעור";
    const sortKey = `${parts.dateYmd}T${parts.timeHhmm ?? "00:00"}`;
    out.push({ className, dateYmd: parts.dateYmd, timeHhmm: parts.timeHhmm, sortKey });
  }
  out.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return out;
}

function formatBookingLine(booking: ScheduleLookupBooking, withBullet: boolean): string {
  const day = hebrewDayFromYmd(booking.dateYmd);
  const date = formatScheduleLookupDate(booking.dateYmd);
  const timePart = booking.timeHhmm ? `, ${booking.timeHhmm}` : "";
  const core = `${booking.className} - ${day} ${date}${timePart}`;
  return withBullet ? `🗓️ ${core}` : core;
}

export function buildScheduleLookupSingleReply(booking: ScheduleLookupBooking): string {
  const day = hebrewDayFromYmd(booking.dateYmd);
  const date = formatScheduleLookupDate(booking.dateYmd);
  const timeBit = booking.timeHhmm ? ` בשעה ${booking.timeHhmm}` : "";
  return `מצאתי! 💜 אני רואה רישום ל-${booking.className} ביום ${day} ${date}${timeBit}.\nנתראה שם! 🙌`;
}

export function buildScheduleLookupMultipleReply(bookings: ScheduleLookupBooking[]): string {
  const lines = bookings.map((b) => formatBookingLine(b, true));
  return `מצאתי כמה שיבוצים קרובים 💜\n${lines.join("\n")}`;
}

export function buildScheduleLookupNoBookingsReply(customerServicePhone: string): string {
  const base =
    "בדקתי ולא מצאתי שיבוצים על המספר הזה בשבועיים הקרובים 🤔\nרוצה שאעביר את הפנייה לצוות כדי לבדוק?";
  const phone = String(customerServicePhone ?? "").trim();
  if (!phone) return base;
  return `${base} אפשר גם טלפונית: ${phone}`;
}

export function buildScheduleLookupPhoneNotFoundReply(): string {
  return "לא מצאתי את המספר הזה במערכת שלנו 🤔 יכול להיות שההרשמה רשומה על מספר אחר?\nאם כן - אפשר לכתוב לי אותו ואבדוק שוב 💜";
}

export function buildScheduleLookupRetryHandoffReply(customerServicePhone: string): string {
  const base = "גם את המספר הזה לא הצלחתי לאתר 💜\nאני מעבירה את הפנייה לצוות שיבדקו ידנית ויחזרו אליך.";
  const phone = String(customerServicePhone ?? "").trim();
  if (!phone) return base;
  return `${base} אפשר גם טלפונית:\n${phone}`;
}

export function buildScheduleLookupFetchFailedReply(customerServicePhone: string): string {
  const base = "לא הצלחתי לבדוק את השיבוצים כרגע 🤔\nאני מעבירה את הפנייה לצוות שיבדקו ידנית ויחזרו אליך.";
  const phone = String(customerServicePhone ?? "").trim();
  if (!phone) return base;
  return `${base} אפשר גם טלפונית: ${phone}`;
}

export function mapScheduleLookupReply(input: {
  bookings: ScheduleLookupBooking[];
  memberMatched: boolean;
  isRetry: boolean;
  customerServicePhone: string;
  fetchFailed?: boolean;
}): ScheduleLookupReply {
  const cs = input.customerServicePhone;
  if (input.fetchFailed) {
    return {
      kind: "fetch_failed",
      text: buildScheduleLookupFetchFailedReply(cs),
      modelUsed: SCHEDULE_LOOKUP_FETCH_FAILED_MODEL,
      notifyHumanRequested: true,
    };
  }
  if (input.bookings.length === 1) {
    return {
      kind: "single",
      text: buildScheduleLookupSingleReply(input.bookings[0]!),
      modelUsed: SCHEDULE_LOOKUP_SINGLE_MODEL,
      notifyHumanRequested: false,
    };
  }
  if (input.bookings.length > 1) {
    return {
      kind: "multiple",
      text: buildScheduleLookupMultipleReply(input.bookings),
      modelUsed: SCHEDULE_LOOKUP_MULTIPLE_MODEL,
      notifyHumanRequested: false,
    };
  }
  if (input.memberMatched) {
    return {
      kind: "no_bookings",
      text: buildScheduleLookupNoBookingsReply(cs),
      modelUsed: SCHEDULE_LOOKUP_NO_BOOKINGS_MODEL,
      notifyHumanRequested: false,
    };
  }
  if (input.isRetry) {
    return {
      kind: "retry_handoff",
      text: buildScheduleLookupRetryHandoffReply(cs),
      modelUsed: SCHEDULE_LOOKUP_RETRY_HANDOFF_MODEL,
      notifyHumanRequested: true,
    };
  }
  return {
    kind: "phone_not_found",
    text: buildScheduleLookupPhoneNotFoundReply(),
    modelUsed: SCHEDULE_LOOKUP_PHONE_NOT_FOUND_MODEL,
    notifyHumanRequested: false,
  };
}

export async function loadArboxScheduleLookupConnection(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<{ apiKey: string; boxId: string } | null> {
  const businessId = Number(input.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return null;
  const { data, error } = await input.supabase
    .from("businesses")
    .select("crm_type, crm_api_key, crm_box_id")
    .eq("id", businessId)
    .maybeSingle();
  if (error) {
    console.error("[schedule-lookup] CRM load failed", { businessId, error: error.message });
    return null;
  }
  if (!canUseArboxScheduleLookup(data)) return null;
  const apiKey = String((data as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
  const boxId = String((data as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
  return { apiKey, boxId };
}

async function loadCachedArboxUserId(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
}): Promise<string | null> {
  const variants = contactPhoneLookupVariants(input.phone);
  if (!variants.length) return null;
  const { data } = await input.supabase
    .from("contacts")
    .select("arbox_user_id")
    .eq("business_id", input.businessId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();
  const id = String((data as { arbox_user_id?: string | null } | null)?.arbox_user_id ?? "").trim();
  return id || null;
}

export async function lookupArboxScheduleByPhone(input: {
  apiKey: string;
  boxId: string;
  lookupPhone: string;
  isRetry: boolean;
  customerServicePhone: string;
  businessId?: number;
  supabase?: ReturnType<typeof createSupabaseAdminClient>;
  now?: Date;
}): Promise<ScheduleLookupReply> {
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const lookupPhone = String(input.lookupPhone ?? "").trim();
  const phoneTail = normalizeIsraeliPhoneTail(lookupPhone);
  const cs = input.customerServicePhone;

  if (!apiKey || !boxId) {
    return mapScheduleLookupReply({
      bookings: [],
      memberMatched: false,
      isRetry: input.isRetry,
      customerServicePhone: cs,
      fetchFailed: true,
    });
  }
  if (!phoneTail) {
    return mapScheduleLookupReply({
      bookings: [],
      memberMatched: false,
      isRetry: input.isRetry,
      customerServicePhone: cs,
    });
  }

  const window = scheduleLookupWindow(input.now);
  const report = await fetchArboxBookingsReport({
    apiKey,
    fromDate: window.fromDate,
    toDate: window.toDate,
    locationId: boxId,
  });
  if (!report.ok) {
    console.error("[schedule-lookup] bookingsReport failed", {
      error: report.error,
      pagesFetched: report.pagesFetched,
    });
    return mapScheduleLookupReply({
      bookings: [],
      memberMatched: false,
      isRetry: input.isRetry,
      customerServicePhone: cs,
      fetchFailed: true,
    });
  }

  let cachedUserId: string | null = null;
  if (input.supabase && input.businessId) {
    cachedUserId = await loadCachedArboxUserId({
      supabase: input.supabase,
      businessId: input.businessId,
      phone: lookupPhone,
    });
  }

  let bookings = mapBookingsForMember(report.rows, { phoneTail, userId: cachedUserId });
  if (bookings.length) {
    return mapScheduleLookupReply({
      bookings,
      memberMatched: true,
      isRetry: input.isRetry,
      customerServicePhone: cs,
    });
  }

  const locationId = parsePositiveIntId(boxId) ?? undefined;
  let foundUserId = cachedUserId;
  if (!foundUserId) {
    try {
      foundUserId = await searchArboxUserByPhone({
        apiKey,
        locationId,
        phone: lookupPhone,
      });
    } catch (e) {
      console.error("[schedule-lookup] searchUser failed", e instanceof Error ? e.message : String(e));
      foundUserId = null;
    }
  }

  if (foundUserId) {
    bookings = mapBookingsForMember(report.rows, { phoneTail, userId: foundUserId });
    if (bookings.length) {
      return mapScheduleLookupReply({
        bookings,
        memberMatched: true,
        isRetry: input.isRetry,
        customerServicePhone: cs,
      });
    }
    return mapScheduleLookupReply({
      bookings: [],
      memberMatched: true,
      isRetry: input.isRetry,
      customerServicePhone: cs,
    });
  }

  return mapScheduleLookupReply({
    bookings: [],
    memberMatched: false,
    isRetry: input.isRetry,
    customerServicePhone: cs,
  });
}
