import assert from "node:assert/strict";
import {
  phoneNumberIdsForOwnerDashboard,
  sessionIdMatchesWaPhoneNumberIds,
} from "@/lib/conversations-sessions";
import type { ActiveWaChannel } from "@/lib/wa-resolve-send-channel";

const staleLowId: ActiveWaChannel = {
  id: 3,
  phoneNumberId: "1048979848304824",
  businessSlug: "acrobyjoe",
  createdAt: "2026-03-30T08:59:35.000Z",
};
const liveHighId: ActiveWaChannel = {
  id: 35,
  phoneNumberId: "1144781695390397",
  businessSlug: "acrobyjoe",
  createdAt: "2026-06-14T13:59:13.000Z",
};
const midId: ActiveWaChannel = {
  id: 34,
  phoneNumberId: "1206517659210231",
  businessSlug: "acrobyjoe",
  createdAt: "2026-06-14T12:45:39.000Z",
};

{
  const ids = phoneNumberIdsForOwnerDashboard([staleLowId, midId, liveHighId]);
  assert.deepEqual(ids, [liveHighId.phoneNumberId], "dashboard uses newest active line only");
  assert.equal(
    sessionIdMatchesWaPhoneNumberIds(`wa_${staleLowId.phoneNumberId}_972501111111`, ids),
    false,
    "old-line sessions are excluded"
  );
  assert.equal(
    sessionIdMatchesWaPhoneNumberIds(`wa_${liveHighId.phoneNumberId}_972501111111`, ids),
    true,
    "current-line sessions are included"
  );
}

{
  const ids = phoneNumberIdsForOwnerDashboard([staleLowId, midId]);
  assert.deepEqual(ids, [midId.phoneNumberId], "newest of remaining active channels");
}

{
  assert.deepEqual(phoneNumberIdsForOwnerDashboard([]), []);
}

console.log("conversations-sessions.test.ts: ok");
