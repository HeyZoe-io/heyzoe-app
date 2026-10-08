import assert from "node:assert/strict";
import {
  claimTrailingUserTurnFromHistory,
  joinInboundUserTexts,
  trailingUserTurnStartIso,
} from "@/lib/wa-inbound-coalesce";

assert.equal(joinInboundUserTexts("איפה החניה", [{ content: "אפשר לשלם במזומן ?" }]), "איפה החניה\nאפשר לשלם במזומן ?");
assert.equal(joinInboundUserTexts("שלום", [{ content: "שלום" }]), "שלום");
assert.equal(joinInboundUserTexts("  ", [{ content: "היי" }]), "היי");
assert.equal(
  joinInboundUserTexts("אני מגיע לבד, זה בסדר?", [{ content: "איך עובד השיעור מה עושים בו ?" }]),
  "אני מגיע לבד, זה בסדר?\nאיך עובד השיעור מה עושים בו ?"
);

const ofriA = "2026-08-30T06:25:20.245548+00:00";
const ofriB = "2026-08-30T06:25:22.202607+00:00";
const ofriHistory = [
  { role: "assistant", content: "כל הכבוד! נרשמת בהצלחה", created_at: "2026-08-30T06:21:42.656295+00:00" },
  { role: "user", content: "מוש!!", created_at: ofriA },
  { role: "user", content: "להביא מזרון?", created_at: ofriB },
];

const claimedBurst = claimTrailingUserTurnFromHistory({
  history: ofriHistory,
  promptText: "מוש!!",
  throughIso: ofriA,
});
assert.equal(claimedBurst.text, "מוש!!\nלהביא מזרון?");
assert.equal(claimedBurst.throughIso, ofriB);
assert.equal(claimedBurst.extraCount, 1, "second inbound in the prompt snapshot is claimed");

const pickupAfterClaim = [{ content: "להביא מזרון?", created_at: ofriB }].filter(
  (row) => row.created_at > claimedBurst.throughIso
);
assert.equal(pickupAfterClaim.length, 0, "V1: pickup must not re-infer the claimed second message");

const claimedDuringInference = claimTrailingUserTurnFromHistory({
  history: ofriHistory.slice(0, 2),
  promptText: "מוש!!",
  throughIso: ofriA,
});
assert.equal(claimedDuringInference.text, "מוש!!");
assert.equal(claimedDuringInference.throughIso, ofriA);
assert.equal(claimedDuringInference.extraCount, 0);
const pickupDuringInference = [{ content: "להביא מזרון?", created_at: ofriB }].filter(
  (row) => row.created_at > claimedDuringInference.throughIso
);
assert.equal(pickupDuringInference.length, 1, "V2: inbound after the prompt snapshot stays pending for pickup");

const uncommittedThroughIso = ofriA;
const pickupAfterCrash = [{ content: "להביא מזרון?", created_at: ofriB }].filter(
  (row) => row.created_at > uncommittedThroughIso
);
assert.equal(pickupAfterCrash.length, 1, "V4: crash before commit leaves the second message pending");

const orA = "2026-10-07T16:56:00.692059+00:00";
const orB = "2026-10-07T16:56:05.038404+00:00";
const orHistory = [
  { role: "assistant", content: "מצטערת לשמוע שברצונך לבטל את המנוי!", created_at: "2026-10-07T13:10:41.159878+00:00" },
  { role: "user", content: "היי\nאני אני רשום לאימון כרגע", created_at: orA },
];
const orStart = trailingUserTurnStartIso(orHistory);
assert.equal(orStart, orA);
const rewound = new Date(Date.parse(orStart!) - 1).toISOString();
const pendingAfterSupersede = [
  { content: "היי\nאני אני רשום לאימון כרגע", created_at: orA },
  { content: "ואני לא יכול להגיע", created_at: orB },
].filter((row) => row.created_at > rewound);
assert.equal(pendingAfterSupersede.length, 2, "superseded reply: pickup re-answers the whole turn");
assert.equal(trailingUserTurnStartIso(orHistory.slice(0, 1)), null);
assert.equal(trailingUserTurnStartIso(ofriHistory), ofriA);

console.log("wa-inbound-coalesce.test.ts: ok");
