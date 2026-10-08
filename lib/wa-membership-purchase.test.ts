import assert from "node:assert/strict";
import {
  MEMBERSHIP_PURCHASE_LINK_MODEL,
  MEMBERSHIP_PURCHASE_TEAM_MODEL,
  resolveMembershipPurchaseReply,
} from "@/lib/wa-membership-purchase";

const url = "https://6kgpdigy.web.arboxapp.com/membership?location=19191";

/** Memberships page set: link, no team alert. */
{
  const r = resolveMembershipPurchaseReply({ membershipsUrl: ` ${url} `, lang: "he", linkAlreadySent: false });
  assert.equal(r.model, MEMBERSHIP_PURCHASE_LINK_MODEL);
  assert.equal(r.notifyTeam, false);
  assert.equal(r.text, `הנה דף המנויים והכרטיסיות, משם אפשר לבחור ולרכוש:\n${url}`);
}

/** No page: team handoff. */
for (const membershipsUrl of ["", "  ", null, undefined]) {
  const r = resolveMembershipPurchaseReply({ membershipsUrl, lang: "he", linkAlreadySent: false });
  assert.equal(r.model, MEMBERSHIP_PURCHASE_TEAM_MODEL);
  assert.equal(r.notifyTeam, true);
  assert.equal(r.text.includes("http"), false);
}

/** Asked again right after the link: team, not the same link twice. */
{
  const r = resolveMembershipPurchaseReply({ membershipsUrl: url, lang: "he", linkAlreadySent: true });
  assert.equal(r.model, MEMBERSHIP_PURCHASE_TEAM_MODEL);
  assert.equal(r.notifyTeam, true);
}

/** English business. */
{
  const r = resolveMembershipPurchaseReply({ membershipsUrl: url, lang: "en", linkAlreadySent: false });
  assert.match(r.text, /^Here is our memberships/);
  assert.equal(r.text.endsWith(url), true);
}

console.log("wa-membership-purchase.test.ts: ok");
