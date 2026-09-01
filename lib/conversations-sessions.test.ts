import assert from "node:assert/strict";
import {
  aggregateSessionsFromMessages,
  dedupeSessionsByPhone,
  phoneNumberIdsForOwnerDashboard,
  sessionAwaitingReply,
  sessionIdMatchesWaPhoneNumberIds,
  type SessionSummary,
} from "@/lib/conversations-sessions";
import { waSessionIdVariantsFromSessionId } from "@/lib/phone-normalize";
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

function session(partial: Partial<SessionSummary> & Pick<SessionSummary, "session_id" | "phone">): SessionSummary {
  return {
    lastAt: "2026-08-20T10:00:00.000Z",
    count: 1,
    isOpen: false,
    isPaused: false,
    ...partial,
  };
}

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

{
  const livePid = liveHighId.phoneNumberId;
  const stalePid = staleLowId.phoneNumberId;
  const collapsed = dedupeSessionsByPhone(
    [
      session({
        session_id: `wa_${stalePid}_972501111111`,
        phone: "972501111111",
        lastAt: "2026-08-20T12:00:00.000Z",
        count: 4,
      }),
      session({
        session_id: `wa_${livePid}_972501111111`,
        phone: "972501111111",
        lastAt: "2026-08-19T09:00:00.000Z",
        count: 2,
      }),
    ],
    [livePid]
  );
  assert.equal(collapsed.length, 1, "same lead on old+new line collapses to one row");
  assert.equal(collapsed[0]?.session_id, `wa_${livePid}_972501111111`, "keeps current-line thread");
  assert.equal(collapsed[0]?.count, 2, "does not add old-line message count");
}

{
  const livePid = liveHighId.phoneNumberId;
  const collapsed = dedupeSessionsByPhone(
    [
      session({
        session_id: `wa_${livePid}_+972501111111`,
        phone: "+972501111111",
        lastAt: "2026-08-20T10:00:00.000Z",
        count: 3,
      }),
      session({
        session_id: `wa_${livePid}_972501111111`,
        phone: "972501111111",
        lastAt: "2026-08-20T10:00:00.000Z",
        count: 2,
      }),
    ],
    [livePid]
  );
  assert.equal(collapsed.length, 1, "+972 and 972 on the same line collapse");
  assert.equal(collapsed[0]?.session_id, `wa_${livePid}_972501111111`, "prefers canonical session_id");
  assert.equal(collapsed[0]?.count, 5, "sums split-thread message counts");
  assert.equal(collapsed[0]?.phone, "972501111111");
}

{
  const variants = waSessionIdVariantsFromSessionId("wa_1144781695390397_+972501111111");
  assert.ok(variants.includes("wa_1144781695390397_972501111111"));
  assert.ok(variants.includes("wa_1144781695390397_+972501111111"));
}

{
  const sid = "wa_1144781695390397_972501111111";
  const newestFirst = aggregateSessionsFromMessages([
    { session_id: sid, role: "user", created_at: "2026-09-01T12:00:00.000Z" },
    { session_id: sid, role: "assistant", created_at: "2026-09-01T11:00:00.000Z" },
  ]);
  assert.equal(newestFirst[0]?.lastFromUser, true, "newest inbound wins even if rows are descending");
  assert.equal(sessionAwaitingReply(newestFirst[0]!), true);

  const afterReply = aggregateSessionsFromMessages([
    { session_id: sid, role: "assistant", created_at: "2026-09-01T12:05:00.000Z" },
    { session_id: sid, role: "user", created_at: "2026-09-01T12:00:00.000Z" },
  ]);
  assert.equal(afterReply[0]?.lastFromUser, false, "assistant reply clears awaiting");
  assert.equal(sessionAwaitingReply(afterReply[0]!), false);

  const eventAfterUser = aggregateSessionsFromMessages([
    { session_id: sid, role: "user", created_at: "2026-09-01T12:00:00.000Z" },
    { session_id: sid, role: "event", created_at: "2026-09-01T12:01:00.000Z" },
  ]);
  assert.equal(eventAfterUser[0]?.lastFromUser, true, "event rows do not clear last customer message");
}

console.log("conversations-sessions.test.ts: ok");
