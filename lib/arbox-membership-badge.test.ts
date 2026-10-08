import assert from "node:assert/strict";
import {
  ARBOX_MEMBERSHIP_BADGE_ACTIVE,
  ARBOX_MEMBERSHIP_BADGE_EXPIRED,
  ARBOX_MEMBERSHIP_BADGE_LEAD,
  ARBOX_MEMBERSHIP_BADGE_REFRESH_MS,
  arboxMembershipBadgeLabel,
  isArboxMembershipBadge,
  membershipBadgeContactPatch,
  shouldRefreshArboxMembershipBadge,
} from "@/lib/arbox-membership-badge";

const NOW = new Date("2026-10-07T18:00:00.000Z");

{
  assert.equal(isArboxMembershipBadge(ARBOX_MEMBERSHIP_BADGE_ACTIVE), true);
  assert.equal(isArboxMembershipBadge(ARBOX_MEMBERSHIP_BADGE_EXPIRED), true);
  assert.equal(isArboxMembershipBadge(ARBOX_MEMBERSHIP_BADGE_LEAD), true);
  assert.equal(isArboxMembershipBadge(null), false);
  assert.deepEqual(
    [ARBOX_MEMBERSHIP_BADGE_ACTIVE, ARBOX_MEMBERSHIP_BADGE_EXPIRED, ARBOX_MEMBERSHIP_BADGE_LEAD],
    ["active", "inactive", "lead"]
  );
  assert.equal(isArboxMembershipBadge("מנוי פעיל"), false);
  assert.equal(isArboxMembershipBadge("Active"), false);
  assert.equal(arboxMembershipBadgeLabel(ARBOX_MEMBERSHIP_BADGE_LEAD, "he"), "ליד");
  assert.equal(arboxMembershipBadgeLabel(ARBOX_MEMBERSHIP_BADGE_ACTIVE, "he"), "מנוי פעיל");
  assert.equal(arboxMembershipBadgeLabel(ARBOX_MEMBERSHIP_BADGE_EXPIRED, "he"), "מנוי לא בתוקף");
  assert.equal(arboxMembershipBadgeLabel(ARBOX_MEMBERSHIP_BADGE_ACTIVE, "en"), "Active member");
}

{
  assert.equal(shouldRefreshArboxMembershipBadge(null, NOW), true);
  assert.equal(shouldRefreshArboxMembershipBadge("", NOW), true);
  assert.equal(shouldRefreshArboxMembershipBadge("not-a-date", NOW), true);
  const fresh = new Date(NOW.getTime() - ARBOX_MEMBERSHIP_BADGE_REFRESH_MS + 60_000).toISOString();
  assert.equal(shouldRefreshArboxMembershipBadge(fresh, NOW), false);
  const stale = new Date(NOW.getTime() - ARBOX_MEMBERSHIP_BADGE_REFRESH_MS).toISOString();
  assert.equal(shouldRefreshArboxMembershipBadge(stale, NOW), true);
}

{
  const same = membershipBadgeContactPatch({
    current: ARBOX_MEMBERSHIP_BADGE_LEAD,
    next: ARBOX_MEMBERSHIP_BADGE_LEAD,
    checkedAtIso: NOW.toISOString(),
  });
  assert.equal("arbox_membership_status" in same, false);
  assert.equal(same.arbox_membership_checked_at, NOW.toISOString());

  const changed = membershipBadgeContactPatch({
    current: null,
    next: ARBOX_MEMBERSHIP_BADGE_EXPIRED,
    checkedAtIso: NOW.toISOString(),
  });
  assert.equal(changed.arbox_membership_status, ARBOX_MEMBERSHIP_BADGE_EXPIRED);
  assert.equal(changed.arbox_membership_checked_at, NOW.toISOString());
}

console.log("arbox-membership-badge.test.ts: ok");
