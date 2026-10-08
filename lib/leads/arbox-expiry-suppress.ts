/**
 * Shared gates for membership_expiring and sessions_expiring.
 *
 * Skip "אימון/אימוני היכרות". "חודש היכרות" stays — that is a real membership.
 * Skip when another in-force membership (מנוי) exists, even if Arbox
 * has_another_plan is "no" (a punch card can sit beside an active plan).
 *
 * Active set = activeMembershipsReport (status active ∪ future-cancel).
 * IO: one report per business per daily run, shared by both steps, only when
 * an expiry rule is on and the cron has not already prefetched it. Not per lead.
 * The send drain loads the same report once per business in that tick.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { fetchArboxActiveMembershipsReport, isArboxActiveCustomerMembershipStatus } from "@/lib/leads/arbox-customer-set";
import { parseLeadIdFromUserId } from "@/lib/leads/arbox-all-leads-report";
import { membershipTypeNameLooksLikeTrial, normalizeMembershipTypeName } from "@/lib/leads/arbox-trial-attended";

export type ActiveMembershipRef = {
  userId: number;
  membershipUserId: number;
  name: string;
};

export type ActiveMembershipIndex = {
  byUser: Map<number, ActiveMembershipRef[]>;
  byMembershipUserId: Map<number, ActiveMembershipRef>;
};

/**
 * Intro class pack ("אימון היכרות" / "אימוני היכרות" / "שיעור הכרות - סטודיו tights").
 * Final-nun singular and regular-nun plural are different letters; הכרות is spelled both ways.
 * Does not match a membership named "חודש היכרות".
 */
export function isIntroWorkoutProductName(raw: unknown): boolean {
  return /(?:שיעור|אימו(?:ן|ני))\s*(?:היכרות|הכרות)/u.test(String(raw ?? ""));
}

/** Pack size written in the product name: "כרטיסיה של 10 כניסות" → 10, "כניסה בודדת" → 1. null when absent. */
export function productNameTotalSessions(raw: unknown): number | null {
  const name = String(raw ?? "");
  if (/(?:כניסה|שיעור|אימון)\s*(?:אחת|אחד|בודד(?:ת)?)|single\s*(?:class|session|entry)/iu.test(name)) return 1;
  const match = /(\d+)\s*(?:כניסות|כניסה|אימונים|אימון|שיעורים|שיעור|sessions?|classes?|entries)/iu.exec(name);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

export type SessionsExpiringExcludedProduct = "intro_workout" | "trial_product" | "single_session";

/**
 * A sessions_expiring row that is not a real punch card: an intro class, a trial product
 * (name, or a business trial membership type), or a one-session product.
 * trialTypeNamesNormalized comes from rows already loaded in the run; no Arbox call here.
 */
export function sessionsExpiringExcludedProduct(input: {
  name: unknown;
  membershipTypeId?: unknown;
  trialTypeIds?: readonly number[];
  trialTypeNamesNormalized?: ReadonlySet<string>;
}): SessionsExpiringExcludedProduct | null {
  if (isIntroWorkoutProductName(input.name)) return "intro_workout";
  if (membershipTypeNameLooksLikeTrial(input.name)) return "trial_product";
  const typeId = Number(input.membershipTypeId);
  if (Number.isFinite(typeId) && typeId > 0 && input.trialTypeIds?.includes(Math.trunc(typeId))) return "trial_product";
  const normalized = normalizeMembershipTypeName(input.name);
  if (normalized && input.trialTypeNamesNormalized?.has(normalized)) return "trial_product";
  if (productNameTotalSessions(input.name) === 1) return "single_session";
  return null;
}

/** Names of the business trial membership types, from membership rows already in hand. */
export function trialTypeNamesFromRows(
  rows: readonly Record<string, unknown>[] | null | undefined,
  trialTypeIds: readonly number[]
): Set<string> {
  const names = new Set<string>();
  if (!trialTypeIds.length) return names;
  for (const row of rows ?? []) {
    const typeId = Number(row.membership_type_id);
    if (!Number.isFinite(typeId) || !trialTypeIds.includes(Math.trunc(typeId))) continue;
    const normalized = normalizeMembershipTypeName(row.membership_type_name);
    if (normalized) names.add(normalized);
  }
  return names;
}

export function indexActiveMemberships(rows: Record<string, unknown>[]): ActiveMembershipIndex {
  const byUser = new Map<number, ActiveMembershipRef[]>();
  const byMembershipUserId = new Map<number, ActiveMembershipRef>();
  for (const row of rows) {
    if (!isArboxActiveCustomerMembershipStatus(row.status)) continue;
    const userId = parseLeadIdFromUserId(row.user_id);
    const membershipUserId = parseLeadIdFromUserId(row.membership_user_id);
    if (userId == null || membershipUserId == null) continue;
    const ref: ActiveMembershipRef = {
      userId,
      membershipUserId,
      name: String(row.membership_type_name ?? "").trim(),
    };
    const list = byUser.get(userId) ?? [];
    list.push(ref);
    byUser.set(userId, list);
    byMembershipUserId.set(membershipUserId, ref);
  }
  return { byUser, byMembershipUserId };
}

/**
 * Punch card (exceptMembershipUserId null): any in-force membership suppresses.
 * Membership row: suppress only when a different membership_user_id is in force.
 */
export function hasAnotherActiveMembership(
  index: ActiveMembershipIndex,
  userId: number,
  exceptMembershipUserId: number | null
): boolean {
  const list = index.byUser.get(userId);
  if (!list?.length) return false;
  if (exceptMembershipUserId == null) return true;
  return list.some((ref) => ref.membershipUserId !== exceptMembershipUserId);
}

/** undefined = fetch. null = already failed, do not refetch. */
export async function loadActiveMembershipIndex(input: {
  apiKey: string;
  boxId: string;
  now?: Date;
  rows?: Record<string, unknown>[] | null;
}): Promise<ActiveMembershipIndex | null> {
  if (input.rows === null) return null;
  if (input.rows) return indexActiveMemberships(input.rows);
  const report = await fetchArboxActiveMembershipsReport({
    apiKey: input.apiKey,
    boxId: input.boxId,
    now: input.now,
  });
  if (!report.ok) {
    console.error("[expiry-suppress] activeMembershipsReport failed", { error: report.error });
    return null;
  }
  return indexActiveMemberships(report.rows);
}

/** sessions_expiring:biz:trigger:userId:start:end */
export function sessionsExpiringIdentityFromDedupKey(dedupKey: string): {
  userId: number;
  startDateYmd: string;
  endDateYmd: string;
} | null {
  const parts = String(dedupKey ?? "").split(":");
  if (parts[0] !== "sessions_expiring" || parts.length < 6) return null;
  const userId = parseLeadIdFromUserId(parts[3]);
  const startDateYmd = String(parts[4] ?? "").trim();
  const endDateYmd = String(parts[5] ?? "").trim();
  if (userId == null || !/^\d{4}-\d{2}-\d{2}$/.test(startDateYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateYmd)) {
    return null;
  }
  return { userId, startDateYmd, endDateYmd };
}

/** membership_expiring:biz:trigger:membershipUserId:end */
export function membershipExpiringIdFromDedupKey(dedupKey: string): number | null {
  const parts = String(dedupKey ?? "").split(":");
  if (parts[0] !== "membership_expiring" || parts.length < 5) return null;
  return parseLeadIdFromUserId(parts[3]);
}

export type ExpirySuppressReason = SessionsExpiringExcludedProduct | "active_membership";

export type ExpirySuppressCache = {
  indexByBox: Map<string, ActiveMembershipIndex | null>;
  packsByUser: Map<string, "failed" | { start: string; end: string; name: string }[]>;
};

export function emptyExpirySuppressCache(): ExpirySuppressCache {
  return { indexByBox: new Map(), packsByUser: new Map() };
}

function ymdPrefix(raw: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? "").trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function membershipRecordDates(row: {
  start_time?: unknown;
  end_time?: unknown;
  membership_type_name?: unknown;
}): { start: string; end: string; name: string } | null {
  const start = ymdPrefix(row.start_time);
  const end = ymdPrefix(row.end_time);
  if (!start || !end) return null;
  return { start, end, name: String(row.membership_type_name ?? "").trim() };
}

/**
 * Send-drain gate. Active-membership or intro lookup failure → send.
 * Daily sync is the primary filter and cancels a pending row once the report is back.
 */
export async function decideScheduledExpirySuppression(input: {
  apiKey: string;
  boxId: string;
  triggerType: string;
  dedupKey: string;
  now?: Date;
  cache: ExpirySuppressCache;
}): Promise<{ action: "send" } | { action: "cancel"; reason: ExpirySuppressReason }> {
  const triggerType = String(input.triggerType ?? "").trim();
  if (triggerType !== "sessions_expiring" && triggerType !== "membership_expiring") {
    return { action: "send" };
  }
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  if (!apiKey || !boxId) return { action: "send" };

  let index = input.cache.indexByBox.get(boxId);
  if (index === undefined) {
    index = await loadActiveMembershipIndex({ apiKey, boxId, now: input.now });
    input.cache.indexByBox.set(boxId, index);
  }
  if (index === null) return { action: "send" };

  if (triggerType === "membership_expiring") {
    const membershipUserId = membershipExpiringIdFromDedupKey(input.dedupKey);
    if (membershipUserId == null) return { action: "send" };
    const ref = index.byMembershipUserId.get(membershipUserId);
    if (ref && isIntroWorkoutProductName(ref.name)) return { action: "cancel", reason: "intro_workout" };
    if (ref && hasAnotherActiveMembership(index, ref.userId, membershipUserId)) {
      return { action: "cancel", reason: "active_membership" };
    }
    return { action: "send" };
  }

  const identity = sessionsExpiringIdentityFromDedupKey(input.dedupKey);
  if (!identity) return { action: "send" };
  if (hasAnotherActiveMembership(index, identity.userId, null)) {
    return { action: "cancel", reason: "active_membership" };
  }

  const packKey = `${boxId}:${identity.userId}`;
  let packs = input.cache.packsByUser.get(packKey);
  if (packs === undefined) {
    const fetched = await arboxPublicFetch(`/v3/users/memberships?user_id=${encodeURIComponent(String(identity.userId))}`, {
      apiKey,
    });
    if (!fetched.ok) {
      input.cache.packsByUser.set(packKey, "failed");
      return { action: "send" };
    }
    const payload = fetched.json as { data?: unknown } | unknown[] | null;
    const data = Array.isArray(payload) ? payload : payload?.data;
    const records = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
    packs = records
      .map((row) => membershipRecordDates(row as { start_time?: unknown; end_time?: unknown; membership_type_name?: unknown }))
      .filter((row): row is { start: string; end: string; name: string } => row != null);
    input.cache.packsByUser.set(packKey, packs);
  }
  if (packs === "failed") return { action: "send" };
  const match = packs.find((row) => row.start === identity.startDateYmd && row.end === identity.endDateYmd);
  const excluded = match ? sessionsExpiringExcludedProduct({ name: match.name }) : null;
  if (excluded) return { action: "cancel", reason: excluded };
  return { action: "send" };
}
