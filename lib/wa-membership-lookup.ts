/**
 * Read-only Arbox membership lookup by phone — on-demand, explicit
 * registration_failed_inquiry only.
 * GET /v3/users/searchUser then GET /v3/users/memberships?user_id=&active=2 (all statuses).
 * Always looks up the WhatsApp sender number (msg.from) only. No Arbox writes. No cache.
 *
 * Remaining-sessions and product→category eligibility are not on the record (Phase 0) —
 * do not scan sessionsReport or guess from membership type names.
 * Trial products are punch-card-like records; v1 copy does not branch on type=trial.
 * `debt` exists on the record (active + debt can block registration) but is out of scope for v1.
 *
 * IO (10x clients): 2 Arbox calls (searchUser + memberships), only when the lead
 * explicitly says registration/booking failed (never per inbound message).
 */

import { arboxPublicFetch, searchArboxUserByPhone } from "@/lib/crm/adapters/arbox";
import { arboxFlagYes, formatDateYmdIsrael, parseEndDateYmd } from "@/lib/leads/arbox-membership-expiring";
import { normalizeIsraeliPhoneTail } from "@/lib/phone-normalize";

/** active=2 returns every membership status (0 inactive / 1 active / 2 all). */
const MEMBERSHIPS_ACTIVE_ALL = "2";

export const MEMBERSHIP_LOOKUP_ACTIVE_REPLY =
  "היי! אני רואה שיש לך מנוי/כרטיסיה בתוקף. אפשר לנסות שוב מהאפליקציה או שאבקש מהצוות שיחזרו אליך! בינתיים אפשר לכתוב לי לאיזה אימון ניסית להירשם?";
export const MEMBERSHIP_LOOKUP_EXPIRED_REPLY =
  "היי! אני רואה שהמנוי/כרטיסיה פג תוקף/לא פעיל. אני אשאיר פנייה שיחזרו אליך בקרוב סבבה?";
export const MEMBERSHIP_LOOKUP_NOT_FOUND_REPLY =
  "אני מבינה, אבקש מהצוות לחזור אליך בהקדם.";
export const MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_REPLY =
  "תודה! אבקש מהצוות לחזור אליך בהקדם.";

export const MEMBERSHIP_LOOKUP_ACTIVE_MODEL = "membership_lookup_active";
export const MEMBERSHIP_LOOKUP_EXPIRED_MODEL = "membership_lookup_expired";
export const MEMBERSHIP_LOOKUP_NOT_FOUND_MODEL = "membership_lookup_not_found";
export const MEMBERSHIP_LOOKUP_FETCH_FAILED_MODEL = "membership_lookup_fetch_failed";
export const MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_MODEL = "membership_lookup_active_followup";

export type ArboxUserMembershipRecord = {
  active?: unknown;
  cancelled?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  membership_type_id?: unknown;
  membership_type_name?: unknown;
  type?: unknown;
  /** Present on live records; not used in v1 classification or copy. */
  debt?: unknown;
};

export type MembershipLookupReplyKind =
  | "active"
  | "expired"
  | "not_found"
  | "fetch_failed"
  | "active_followup";

export type MembershipLookupReply = {
  kind: MembershipLookupReplyKind;
  text: string;
  modelUsed: string;
  notifyHumanRequested: boolean;
};

function parsePositiveIntId(value: string | null | undefined): number | null {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseArboxMembershipRecords(json: unknown): ArboxUserMembershipRecord[] {
  const payload = json as { data?: unknown } | unknown[] | null;
  const data = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
  if (Array.isArray(data)) return data as ArboxUserMembershipRecord[];
  if (data && typeof data === "object") return [data as ArboxUserMembershipRecord];
  return [];
}

/**
 * In-force = active === 1 AND cancelled !== 1 AND (end_time is null OR end_time >= today).
 * A null end_time is an open-ended active membership, not expired.
 * Does not inspect type (trial vs regular) or debt.
 */
export function isInForceMembership(row: ArboxUserMembershipRecord, todayYmd: string): boolean {
  if (!arboxFlagYes(row.active)) return false;
  if (arboxFlagYes(row.cancelled)) return false;
  const endYmd = parseEndDateYmd(row.end_time);
  if (!endYmd) return true;
  return endYmd >= todayYmd;
}

export function classifyMembershipLookup(input: {
  userFound: boolean;
  records: ArboxUserMembershipRecord[];
  todayYmd: string;
  fetchFailed?: boolean;
}): Exclude<MembershipLookupReplyKind, "active_followup"> {
  if (input.fetchFailed) return "fetch_failed";
  if (!input.userFound) return "not_found";
  if (input.records.some((row) => isInForceMembership(row, input.todayYmd))) return "active";
  return "expired";
}

export function mapMembershipLookupReply(kind: MembershipLookupReplyKind): MembershipLookupReply {
  switch (kind) {
    case "active":
      return {
        kind,
        text: MEMBERSHIP_LOOKUP_ACTIVE_REPLY,
        modelUsed: MEMBERSHIP_LOOKUP_ACTIVE_MODEL,
        notifyHumanRequested: false,
      };
    case "expired":
      return {
        kind,
        text: MEMBERSHIP_LOOKUP_EXPIRED_REPLY,
        modelUsed: MEMBERSHIP_LOOKUP_EXPIRED_MODEL,
        notifyHumanRequested: true,
      };
    case "not_found":
      return {
        kind,
        text: MEMBERSHIP_LOOKUP_NOT_FOUND_REPLY,
        modelUsed: MEMBERSHIP_LOOKUP_NOT_FOUND_MODEL,
        notifyHumanRequested: true,
      };
    case "fetch_failed":
      return {
        kind,
        text: MEMBERSHIP_LOOKUP_NOT_FOUND_REPLY,
        modelUsed: MEMBERSHIP_LOOKUP_FETCH_FAILED_MODEL,
        notifyHumanRequested: true,
      };
    case "active_followup":
      return {
        kind,
        text: MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_REPLY,
        modelUsed: MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_MODEL,
        notifyHumanRequested: true,
      };
  }
}

export async function fetchArboxUserMemberships(input: {
  apiKey: string;
  userId: string;
}): Promise<
  { ok: true; records: ArboxUserMembershipRecord[] } | { ok: false; error: string; status?: number }
> {
  const userId = String(input.userId ?? "").trim();
  if (!userId) return { ok: false, error: "missing_user_id" };
  const qs = new URLSearchParams({ user_id: userId, active: MEMBERSHIPS_ACTIVE_ALL });
  const res = await arboxPublicFetch(`/v3/users/memberships?${qs.toString()}`, {
    apiKey: input.apiKey,
  });
  if (!res.ok) {
    console.error("[membership-lookup] memberships fetch failed", {
      status: res.status,
      userId,
      body: res.rawText.slice(0, 500),
    });
    return { ok: false, error: "memberships_fetch_failed", status: res.status };
  }
  return { ok: true, records: parseArboxMembershipRecords(res.json) };
}

export async function lookupArboxMembershipByPhone(input: {
  apiKey: string;
  boxId: string;
  lookupPhone: string;
  now?: Date;
}): Promise<MembershipLookupReply> {
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const lookupPhone = String(input.lookupPhone ?? "").trim();
  const todayYmd = formatDateYmdIsrael(input.now ?? new Date());

  if (!apiKey || !boxId) {
    return mapMembershipLookupReply("fetch_failed");
  }

  const phoneTail = normalizeIsraeliPhoneTail(lookupPhone);
  if (!phoneTail) {
    return mapMembershipLookupReply("not_found");
  }

  const locationId = parsePositiveIntId(boxId) ?? undefined;
  let foundUserId: string | null = null;
  try {
    foundUserId = await searchArboxUserByPhone({
      apiKey,
      locationId,
      phone: lookupPhone,
    });
  } catch (e) {
    console.error("[membership-lookup] searchUser failed", e instanceof Error ? e.message : String(e));
    return mapMembershipLookupReply("fetch_failed");
  }

  if (!foundUserId) {
    return mapMembershipLookupReply("not_found");
  }

  const memberships = await fetchArboxUserMemberships({ apiKey, userId: foundUserId });
  if (!memberships.ok) {
    return mapMembershipLookupReply("fetch_failed");
  }

  return mapMembershipLookupReply(
    classifyMembershipLookup({
      userFound: true,
      records: memberships.records,
      todayYmd,
    })
  );
}
