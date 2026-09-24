/**
 * People who should not get lost-lead win-back or silence re-engage:
 * active membership (מנוי), active punch card (כרטיסיה), or a trial class
 * still on the calendar (today through +14 days).
 *
 * IO per business per cron (only when a send is about to happen):
 * 1 activeMembershipsReport + 1 sessionsReport + 1 future bookingsReport.
 * +1 membershipTypes GET only when the business has trial product ids.
 * Not per lead.
 */
import { fetchAllArboxMembershipTypes, membershipTypeNameById } from "@/lib/arbox-membership-types";
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { sharedFutureBookingsWindow } from "@/lib/leads/arbox-attendance-gap";
import {
  buildSessionsReportPath,
  customerReportsDateRange,
  fetchArboxActiveMembershipsReport,
  isArboxActiveCustomerMembershipStatus,
  isArboxActiveCustomerSessionStatus,
} from "@/lib/leads/arbox-customer-set";
import { parseLeadIdFromUserId } from "@/lib/leads/arbox-all-leads-report";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";
import {
  bookingMatchesTrialScope,
  formatDateYmdIsrael,
  membershipTypeNameLooksLikeTrial,
  normalizeMembershipTypeName,
  parseClassDateYmd,
  fetchArboxBookingsReport,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { canUseArboxScheduleLookup } from "@/lib/crm/types";
import { normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type ActiveProductKeys = {
  userIds: Set<number>;
  phones: Set<string>;
};

function emptyKeys(): ActiveProductKeys {
  return { userIds: new Set(), phones: new Set() };
}

function addIdentity(
  keys: ActiveProductKeys,
  row: { user_id?: unknown; phone?: unknown; additional_phone?: unknown }
): void {
  const id = parseLeadIdFromUserId(row.user_id);
  if (id != null) keys.userIds.add(id);
  const phone = normalizePhone(row.phone) ?? normalizePhone(row.additional_phone);
  if (phone) keys.phones.add(phone);
}

function parseIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n))
    ),
  ];
}

/** Trial class that has not passed yet (today or later), by configured ids or a trial-like name. */
export function isUpcomingTrialBooking(input: {
  row: ArboxBookingReportRow;
  todayYmd: string;
  trialTypeIds: readonly number[];
  trialTypeNamesNormalized: ReadonlySet<string>;
}): boolean {
  const ymd = parseClassDateYmd(input.row.date);
  if (!ymd || ymd < input.todayYmd) return false;
  if (membershipTypeNameLooksLikeTrial(input.row.membership_type_name)) return true;
  return bookingMatchesTrialScope(input.row, {
    trialTypeIds: [...input.trialTypeIds],
    trialTypeNamesNormalized: new Set(input.trialTypeNamesNormalized),
  });
}

export function collectActiveProductKeys(input: {
  membershipRows: Record<string, unknown>[];
  sessionRows: Record<string, unknown>[];
  bookingRows: ArboxBookingReportRow[];
  todayYmd: string;
  trialTypeIds: readonly number[];
  trialTypeNamesNormalized: ReadonlySet<string>;
}): ActiveProductKeys {
  const keys = emptyKeys();
  for (const row of input.membershipRows) {
    if (!isArboxActiveCustomerMembershipStatus(row.status)) continue;
    addIdentity(keys, row);
  }
  for (const row of input.sessionRows) {
    if (!isArboxActiveCustomerSessionStatus(row.status)) continue;
    addIdentity(keys, row);
  }
  for (const row of input.bookingRows) {
    if (
      !isUpcomingTrialBooking({
        row,
        todayYmd: input.todayYmd,
        trialTypeIds: input.trialTypeIds,
        trialTypeNamesNormalized: input.trialTypeNamesNormalized,
      })
    ) {
      continue;
    }
    addIdentity(keys, row);
  }
  return keys;
}

export function matchesActiveProduct(input: {
  userId: number | null;
  phone: string | null;
  keys: ActiveProductKeys;
}): boolean {
  if (input.userId != null && input.keys.userIds.has(input.userId)) return true;
  const phone = normalizePhone(input.phone);
  return Boolean(phone && input.keys.phones.has(phone));
}

/** Lead-style sends that must not go out to someone with an active product. */
export const ACTIVE_PRODUCT_SUPPRESS_TRIGGER_TYPES = [
  "lost_lead",
  "no_response",
  "membership_cancelled",
  "not_registered_after_trial",
  "missed_trial",
  "birthday_former",
  "arbox_new_lead",
  "incoming_lead",
] as const;

export function triggerSuppressesActiveProduct(triggerType: string): boolean {
  return (ACTIVE_PRODUCT_SUPPRESS_TRIGGER_TYPES as readonly string[]).includes(triggerType);
}

export async function fetchArboxActiveProductKeys(input: {
  apiKey: string;
  boxId: string;
  trialMembershipTypeIds?: unknown;
  now?: Date;
  fetchPage?: typeof arboxPublicFetch;
  /** Skip the memberships GET when the cron already loaded this report. */
  prefetchedMembershipRows?: Record<string, unknown>[];
}): Promise<{ ok: true; keys: ActiveProductKeys } | { ok: false; error: string }> {
  const now = input.now ?? new Date();
  const todayYmd = formatDateYmdIsrael(now);
  const trialTypeIds = parseIdList(input.trialMembershipTypeIds);

  let membershipRows: Record<string, unknown>[];
  if (input.prefetchedMembershipRows) {
    membershipRows = input.prefetchedMembershipRows;
  } else {
    const memberships = await fetchArboxActiveMembershipsReport({
      apiKey: input.apiKey,
      boxId: input.boxId,
      now,
      fetchPage: input.fetchPage,
    });
    if (!memberships.ok) return { ok: false, error: memberships.error };
    membershipRows = memberships.rows;
  }

  const { fromDate, toDate } = customerReportsDateRange(now);
  const sessions = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.boxId,
    logLabel: "leads/arbox-active-product/sessionsReport",
    buildPath: (page) =>
      buildSessionsReportPath({
        fromDate,
        toDate,
        locationId: input.boxId,
        page,
      }),
    fetchPage: input.fetchPage,
  });
  if (!sessions.ok) return { ok: false, error: "arbox_sessions_report_fetch_failed" };

  const future = sharedFutureBookingsWindow(now, { includeToday: true });
  const bookings = await fetchArboxBookingsReport({
    apiKey: input.apiKey,
    fromDate: future.fromDate,
    toDate: future.toDate,
    locationId: input.boxId,
  });
  if (!bookings.ok) return { ok: false, error: bookings.error };

  const trialTypeNamesNormalized = new Set<string>();
  if (trialTypeIds.length) {
    const types = await fetchAllArboxMembershipTypes({
      apiKey: input.apiKey,
      fetchPage: input.fetchPage,
      logLabel: "leads/arbox-active-product/membershipTypes",
    });
    if (!types.ok) return { ok: false, error: "arbox_membership_types_fetch_failed" };
    const nameById = membershipTypeNameById(types.types);
    for (const id of trialTypeIds) {
      const name = nameById.get(id);
      if (name) trialTypeNamesNormalized.add(normalizeMembershipTypeName(name));
    }
  }

  return {
    ok: true,
    keys: collectActiveProductKeys({
      membershipRows,
      sessionRows: sessions.rows,
      bookingRows: bookings.rows,
      todayYmd,
      trialTypeIds,
      trialTypeNamesNormalized,
    }),
  };
}

/**
 * One Arbox read for a business. `keys: null` means no Arbox connection — do not suppress.
 * IO: memberships (unless prefetched) + sessions + future bookings, + membershipTypes if trial ids exist.
 */
export async function loadBusinessActiveProductKeys(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  now?: Date;
  prefetchedMembershipRows?: Record<string, unknown>[];
}): Promise<
  | { ok: true; keys: ActiveProductKeys | null }
  | { ok: false; error: string }
> {
  const { data, error } = await input.admin
    .from("businesses")
    .select("crm_type, crm_api_key, crm_box_id, arbox_trial_membership_type_ids")
    .eq("id", input.businessId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!canUseArboxScheduleLookup(data)) return { ok: true, keys: null };
  const apiKey = String((data as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
  const boxId = String((data as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
  const fetched = await fetchArboxActiveProductKeys({
    apiKey,
    boxId,
    now: input.now,
    trialMembershipTypeIds: (data as { arbox_trial_membership_type_ids?: unknown })
      .arbox_trial_membership_type_ids,
    prefetchedMembershipRows: input.prefetchedMembershipRows,
  });
  if (!fetched.ok) return fetched;
  return { ok: true, keys: fetched.keys };
}
