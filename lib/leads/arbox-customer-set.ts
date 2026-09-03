import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";
import { parseLeadIdFromUserId } from "@/lib/leads/arbox-all-leads-report";

const ISRAEL_TZ = "Asia/Jerusalem";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CUSTOMER_REPORT_SPAN_DAYS = 30;

export const ARBOX_ACTIVE_MEMBERSHIP_STATUSES = [
  "active",
  "activeMemberWithFutureCancel",
] as const;

export function formatCustomerReportDateYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function customerReportsDateRange(now: Date = new Date()): {
  fromDate: string;
  toDate: string;
} {
  const toDate = formatCustomerReportDateYmd(now);
  const fromDate = formatCustomerReportDateYmd(
    new Date(now.getTime() - CUSTOMER_REPORT_SPAN_DAYS * MS_PER_DAY)
  );
  return { fromDate, toDate };
}

export function isArboxActiveCustomerMembershipStatus(status: unknown): boolean {
  const s = String(status ?? "").trim();
  return (ARBOX_ACTIVE_MEMBERSHIP_STATUSES as readonly string[]).includes(s);
}

export function isArboxActiveCustomerSessionStatus(status: unknown): boolean {
  return String(status ?? "").trim() === "active";
}

export function buildActiveMembershipsReportPath(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  page?: number;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    location_id: input.locationId,
  });
  if (input.page != null && input.page > 1) qs.set("page", String(input.page));
  return `/v3/reports/activeMembershipsReport?${qs.toString()}`;
}

export function buildSessionsReportPath(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  page?: number;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    location_id: input.locationId,
  });
  if (input.page != null && input.page > 1) qs.set("page", String(input.page));
  return `/v3/reports/sessionsReport?${qs.toString()}`;
}

/** In-memory customer set: active memberships ∪ active sessions/punch-cards/one-offs. */
export function collectArboxCustomerUserIds(input: {
  membershipRows: Record<string, unknown>[];
  sessionRows: Record<string, unknown>[];
}): Set<number> {
  const ids = new Set<number>();
  for (const row of input.membershipRows) {
    if (!isArboxActiveCustomerMembershipStatus(row.status)) continue;
    const id = parseLeadIdFromUserId(row.user_id);
    if (id != null) ids.add(id);
  }
  for (const row of input.sessionRows) {
    if (!isArboxActiveCustomerSessionStatus(row.status)) continue;
    const id = parseLeadIdFromUserId(row.user_id);
    if (id != null) ids.add(id);
  }
  return ids;
}

export async function fetchArboxCustomerUserIds(input: {
  apiKey: string;
  boxId: string;
  now?: Date;
  fetchPage?: typeof arboxPublicFetch;
}): Promise<
  | { ok: true; userIds: Set<number>; membershipPages: number; sessionPages: number }
  | { ok: false; error: string }
> {
  const { fromDate, toDate } = customerReportsDateRange(input.now);
  const memberships = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.boxId,
    logLabel: "leads/arbox-new-lead/activeMembershipsReport",
    buildPath: (page) =>
      buildActiveMembershipsReportPath({
        fromDate,
        toDate,
        locationId: input.boxId,
        page,
      }),
    fetchPage: input.fetchPage,
  });
  if (!memberships.ok) {
    return { ok: false, error: "arbox_active_memberships_fetch_failed" };
  }

  const sessions = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.boxId,
    logLabel: "leads/arbox-new-lead/sessionsReport",
    buildPath: (page) =>
      buildSessionsReportPath({
        fromDate,
        toDate,
        locationId: input.boxId,
        page,
      }),
    fetchPage: input.fetchPage,
  });
  if (!sessions.ok) {
    return { ok: false, error: "arbox_sessions_report_fetch_failed" };
  }

  return {
    ok: true,
    userIds: collectArboxCustomerUserIds({
      membershipRows: memberships.rows,
      sessionRows: sessions.rows,
    }),
    membershipPages: memberships.pagesFetched,
    sessionPages: sessions.pagesFetched,
  };
}

/** Fetch customer reports only when at least one unseen, non-Zoe lead remains. */
export function shouldFetchArboxCustomerSet(unseenNonZoeCount: number): boolean {
  return unseenNonZoeCount > 0;
}
