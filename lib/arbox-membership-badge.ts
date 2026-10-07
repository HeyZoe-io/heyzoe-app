/** Stored on contacts.arbox_membership_status. Null means not checked. */
export const ARBOX_MEMBERSHIP_BADGE_ACTIVE = "מנוי פעיל";
export const ARBOX_MEMBERSHIP_BADGE_EXPIRED = "מנוי לא בתוקף";
export const ARBOX_MEMBERSHIP_BADGE_LEAD = "ליד";

export const ARBOX_MEMBERSHIP_BADGES = [
  ARBOX_MEMBERSHIP_BADGE_ACTIVE,
  ARBOX_MEMBERSHIP_BADGE_EXPIRED,
  ARBOX_MEMBERSHIP_BADGE_LEAD,
] as const;

export type ArboxMembershipBadge = (typeof ARBOX_MEMBERSHIP_BADGES)[number];

/** One lookup per contact at most this often, and only when they message. */
export const ARBOX_MEMBERSHIP_BADGE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export function isArboxMembershipBadge(value: unknown): value is ArboxMembershipBadge {
  return (ARBOX_MEMBERSHIP_BADGES as readonly string[]).includes(String(value ?? "").trim());
}

export function arboxMembershipBadgeLabel(
  value: ArboxMembershipBadge,
  lang: "he" | "en"
): string {
  if (lang === "he") return value;
  if (value === ARBOX_MEMBERSHIP_BADGE_ACTIVE) return "Active member";
  if (value === ARBOX_MEMBERSHIP_BADGE_EXPIRED) return "Membership expired";
  return "Lead";
}

/** First message (null) and a check older than 7 days. */
export function shouldRefreshArboxMembershipBadge(
  checkedAtIso: string | null | undefined,
  now: Date = new Date()
): boolean {
  const raw = String(checkedAtIso ?? "").trim();
  if (!raw) return true;
  const checkedMs = new Date(raw).getTime();
  if (!Number.isFinite(checkedMs)) return true;
  return now.getTime() - checkedMs >= ARBOX_MEMBERSHIP_BADGE_REFRESH_MS;
}

/**
 * Status is included only when it changes. checked_at still moves so the next
 * inbound does not call Arbox again before 7 days.
 */
export function membershipBadgeContactPatch(input: {
  current: string | null | undefined;
  next: ArboxMembershipBadge;
  checkedAtIso: string;
}): Record<string, unknown> {
  const current = String(input.current ?? "").trim();
  if (current === input.next) {
    return { arbox_membership_checked_at: input.checkedAtIso };
  }
  return {
    arbox_membership_status: input.next,
    arbox_membership_checked_at: input.checkedAtIso,
  };
}
