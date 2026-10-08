/**
 * Read-only Arbox membership lookup by phone — on-demand, explicit
 * registration_failed_inquiry or a «when does my membership end» question only.
 * GET /v3/users/searchUser then GET /v3/users/memberships?user_id= (no `active` filter).
 * Always looks up the WhatsApp sender number (msg.from) only. No Arbox writes. No cache.
 *
 * Live Arbox (Limitless, Aug 2026): `active=1` = in-force only, `active=0` = inactive only,
 * `active=2` returns empty (HTTP 200 / JSON 204) even when the user has cards.
 * Omitting `active` returns the complete set (active + expired/cancelled). Classify from
 * record fields — never from empty/non-empty of a filtered query.
 *
 * Remaining-sessions and product→category eligibility are not on the record (Phase 0) —
 * do not scan sessionsReport or guess from membership type names.
 * Trial products are punch-card-like records; v1 copy does not branch on type=trial.
 * `debt` on an in-force record (amount owed, live type number ≥ 0) can block
 * class registration — that is a sub-branch of ACTIVE (handoff), not a top-level case.
 * Expired/cancelled cards with debt stay EXPIRED.
 *
 * IO (10x clients): 2 Arbox calls (searchUser + memberships), only when the lead
 * explicitly says registration/booking failed or asks when the membership ends
 * (never per inbound message).
 */

import { arboxPublicFetch, searchArboxUserByPhone } from "@/lib/crm/adapters/arbox";
import { guardPreClaudeOutbound } from "@/lib/wa-pre-claude-guard";
import { arboxFlagYes, formatDateYmdIsrael, parseEndDateYmd } from "@/lib/leads/arbox-membership-expiring";
import { normalizeIsraeliPhoneTail } from "@/lib/phone-normalize";

export const MEMBERSHIP_LOOKUP_ACTIVE_REPLY =
  "היי! אני רואה שיש לך מנוי/כרטיסיה בתוקף. אני מעבירה לצוות שיבדקו למה ההרשמה לא עוברת ויחזרו אליך 💜";
export const MEMBERSHIP_LOOKUP_ACTIVE_DEBT_REPLY =
  "אני רואה שיש חוב במערכת, אבל אני לא מעודכנת בכל הפרטים אז אני מעבירה לצוות שיסתכלו 💜";
export const MEMBERSHIP_LOOKUP_EXPIRED_REPLY =
  "היי! אני רואה שהמנוי/כרטיסיה פג תוקף/לא פעיל. אני אשאיר פנייה שיחזרו אליך בקרוב סבבה?";
export const MEMBERSHIP_LOOKUP_NOT_FOUND_REPLY =
  "אני מבינה, אבקש מהצוות לחזור אליך בהקדם.";
export const MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_REPLY =
  "תודה! אבקש מהצוות לחזור אליך בהקדם.";

export const MEMBERSHIP_LOOKUP_ACTIVE_MODEL = "membership_lookup_active";
export const MEMBERSHIP_LOOKUP_ACTIVE_DEBT_MODEL = "membership_lookup_active_debt";
export const MEMBERSHIP_LOOKUP_EXPIRED_MODEL = "membership_lookup_expired";
export const MEMBERSHIP_LOOKUP_NOT_FOUND_MODEL = "membership_lookup_not_found";
export const MEMBERSHIP_LOOKUP_FETCH_FAILED_MODEL = "membership_lookup_fetch_failed";
export const MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_MODEL = "membership_lookup_active_followup";
export const MEMBERSHIP_END_DATE_MODEL = "membership_end_date";
export const MEMBERSHIP_END_DATE_OPEN_MODEL = "membership_end_date_open";

/** Arbox does not expose auto-renew — never claim it renews, only the in-force date. */
export function buildMembershipEndDateReply(endYmd: string): string {
  const [y, m, d] = endYmd.split("-");
  return `המנוי שלך בתוקף עד ${d}.${m}.${y}. אני לא רואה אם הוא מתחדש או לא :) אבל אם לא ביקשת לבטל, הוא כנראה מתחדש.`;
}

/**
 * Personal «when does my membership renew / end» question.
 * Cancel / freeze / refund wording stays with the closed playbooks.
 */
export function isMembershipEndDateAsk(raw: string): boolean {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 200) return false;
  if (!/מנוי/u.test(t)) return false;
  if (/לבטל|ביטול|מבטל|להקפיא|הקפא|הקפאה|החזר/u.test(t)) return false;
  if (!/מתי|תאריך|עד איזה|עד איזו/u.test(t)) return false;
  return /מתחדש|חידוש|יתחדש|נגמר|ייגמר|יגמר|מסתיים|יסתיים|תוקף|פג|יפוג/u.test(t);
}

export type ArboxUserMembershipRecord = {
  active?: unknown;
  cancelled?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  membership_type_id?: unknown;
  membership_type_name?: unknown;
  type?: unknown;
  /** Per-membership amount owed. Live type is number ≥ 0; coerce strings. Credit (< 0) is ignored. */
  debt?: unknown;
};

export type MembershipLookupReplyKind =
  | "active"
  | "active_debt"
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
 * In-force = active === 1 AND cancelled === 0 AND (end_time is null OR end_time >= today).
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

/** Amount owed on the record. Live Arbox is a non-negative number; coerce strings. Credit (< 0) is not debt. */
export function hasPositiveMembershipDebt(raw: unknown): boolean {
  if (raw == null || raw === "") return false;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) && n > 0;
}

/**
 * Classify from record fields after a full (unfiltered) memberships fetch.
 * not_found is only for searchUser miss — never from an empty filtered memberships query.
 * User exists + no in-force row (including zero memberships) → expired copy (handoff).
 * In-force + any of those rows has debt > 0 → active_debt (ACTIVE sub-branch, team handoff).
 */
export function classifyMembershipLookup(input: {
  userFound: boolean;
  records: ArboxUserMembershipRecord[];
  todayYmd: string;
  fetchFailed?: boolean;
}): Exclude<MembershipLookupReplyKind, "active_followup"> {
  if (input.fetchFailed) return "fetch_failed";
  if (!input.userFound) return "not_found";
  const inForce = input.records.filter((row) => isInForceMembership(row, input.todayYmd));
  if (inForce.length === 0) return "expired";
  if (inForce.some((row) => hasPositiveMembershipDebt(row.debt))) return "active_debt";
  return "active";
}

/**
 * Latest end date across in-force rows. An in-force row with no end_time is open-ended:
 * there is no date to quote. Null when nothing is in force.
 */
export function pickMembershipEndDate(input: {
  records: ArboxUserMembershipRecord[];
  todayYmd: string;
}): { kind: "until"; endYmd: string } | { kind: "open" } | null {
  const inForce = input.records.filter((row) => isInForceMembership(row, input.todayYmd));
  if (inForce.length === 0) return null;
  let latest: string | null = null;
  for (const row of inForce) {
    const endYmd = parseEndDateYmd(row.end_time);
    if (!endYmd) return { kind: "open" };
    if (!latest || endYmd > latest) latest = endYmd;
  }
  return latest ? { kind: "until", endYmd: latest } : { kind: "open" };
}

/** Full set for one user — do not pass `active` (see file header). */
export function buildArboxUserMembershipsPath(userId: string): string {
  const qs = new URLSearchParams({ user_id: String(userId ?? "").trim() });
  return `/v3/users/memberships?${qs.toString()}`;
}

export function mapMembershipLookupReply(kind: MembershipLookupReplyKind): MembershipLookupReply {
  switch (kind) {
    case "active":
      return {
        kind,
        text: MEMBERSHIP_LOOKUP_ACTIVE_REPLY,
        modelUsed: MEMBERSHIP_LOOKUP_ACTIVE_MODEL,
        notifyHumanRequested: true,
      };
    case "active_debt":
      return {
        kind,
        text: MEMBERSHIP_LOOKUP_ACTIVE_DEBT_REPLY,
        modelUsed: MEMBERSHIP_LOOKUP_ACTIVE_DEBT_MODEL,
        notifyHumanRequested: true,
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
  const res = await arboxPublicFetch(buildArboxUserMembershipsPath(userId), {
    apiKey: input.apiKey,
  });
  if (!res.ok) {
    console.error("[membership-lookup] memberships fetch failed", {
      status: res.status,
      userId,
    });
    return { ok: false, error: "memberships_fetch_failed", status: res.status };
  }
  return { ok: true, records: parseArboxMembershipRecords(res.json) };
}

async function fetchMembershipRecordsByPhone(input: {
  apiKey: string;
  boxId: string;
  lookupPhone: string;
}): Promise<
  { status: "ok"; records: ArboxUserMembershipRecord[] } | { status: "not_found" | "fetch_failed" }
> {
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const lookupPhone = String(input.lookupPhone ?? "").trim();

  if (!apiKey || !boxId) return { status: "fetch_failed" };

  const phoneTail = normalizeIsraeliPhoneTail(lookupPhone);
  if (!phoneTail) return { status: "not_found" };

  const locationId = parsePositiveIntId(boxId) ?? undefined;
  let foundUserId: string | null = null;
  try {
    foundUserId = await searchArboxUserByPhone({
      apiKey,
      locationId,
      phone: lookupPhone,
    });
  } catch {
    console.error("[membership-lookup] searchUser failed", { status: "network" });
    return { status: "fetch_failed" };
  }

  if (!foundUserId) return { status: "not_found" };

  const memberships = await fetchArboxUserMemberships({ apiKey, userId: foundUserId });
  if (!memberships.ok) return { status: "fetch_failed" };
  return { status: "ok", records: memberships.records };
}

export async function lookupArboxMembershipByPhone(input: {
  apiKey: string;
  boxId: string;
  lookupPhone: string;
  now?: Date;
}): Promise<MembershipLookupReply> {
  guardPreClaudeOutbound("lookupArboxMembershipByPhone");
  const todayYmd = formatDateYmdIsrael(input.now ?? new Date());
  const fetched = await fetchMembershipRecordsByPhone(input);
  if (fetched.status !== "ok") return mapMembershipLookupReply(fetched.status);

  return mapMembershipLookupReply(
    classifyMembershipLookup({
      userFound: true,
      records: fetched.records,
      todayYmd,
    })
  );
}

/**
 * «מתי מתחדש לי המנוי?» — same 2 Arbox reads, only when Claude confirms the hint.
 * In force with a date: the date, no team alert. Open-ended, expired, not found,
 * or a failed read: the existing handoff copy.
 */
export function mapMembershipEndDateReply(input: {
  fetched:
    | { status: "ok"; records: ArboxUserMembershipRecord[] }
    | { status: "not_found" | "fetch_failed" };
  todayYmd: string;
}): MembershipLookupReply {
  if (input.fetched.status !== "ok") return mapMembershipLookupReply(input.fetched.status);
  const picked = pickMembershipEndDate({ records: input.fetched.records, todayYmd: input.todayYmd });
  if (!picked) return mapMembershipLookupReply("expired");
  if (picked.kind === "open") {
    return {
      kind: "active",
      text: MEMBERSHIP_LOOKUP_NOT_FOUND_REPLY,
      modelUsed: MEMBERSHIP_END_DATE_OPEN_MODEL,
      notifyHumanRequested: true,
    };
  }
  return {
    kind: "active",
    text: buildMembershipEndDateReply(picked.endYmd),
    modelUsed: MEMBERSHIP_END_DATE_MODEL,
    notifyHumanRequested: false,
  };
}

export async function lookupArboxMembershipEndDateByPhone(input: {
  apiKey: string;
  boxId: string;
  lookupPhone: string;
  now?: Date;
}): Promise<MembershipLookupReply> {
  guardPreClaudeOutbound("lookupArboxMembershipEndDateByPhone");
  const todayYmd = formatDateYmdIsrael(input.now ?? new Date());
  const fetched = await fetchMembershipRecordsByPhone(input);
  return mapMembershipEndDateReply({ fetched, todayYmd });
}

