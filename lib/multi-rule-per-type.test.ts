import assert from "node:assert/strict";
import {
  backfillTriggerIdsForLiveRules,
  ruleIsDue,
  rulesNotYetHandled,
  SYNC_LOG_SENTINEL_TRIGGER_ID,
} from "@/lib/multi-rule-dedup";
import { trialBookingTemplateFollowUp } from "@/lib/leads/arbox-trial-booking-confirm";

type Rule = { id: string; delayDays: number; delayLess: boolean };

/**
 * Same decision the send loops use: a rule fires when it is due and its
 * trigger id is not already in the log. The migration copies a pre-migration
 * event onto every live rule id, so the next run does not send it again.
 */
function run(input: {
  rules: Rule[];
  eventId: string;
  offsetDays: number;
  log: Map<string, Set<string>>;
  preMigration?: boolean;
}): string[] {
  if (input.preMigration && !input.log.has(input.eventId)) {
    input.log.set(input.eventId, new Set(backfillTriggerIdsForLiveRules(input.rules.map((rule) => rule.id))));
  }
  const handled = input.log.get(input.eventId) ?? new Set<string>();
  const pending = rulesNotYetHandled(input.rules, handled).filter((rule) =>
    ruleIsDue({
      delayDays: rule.delayDays,
      eventOffsetDays: input.offsetDays,
      delayLess: rule.delayLess,
    })
  );
  for (const rule of pending) handled.add(rule.id);
  input.log.set(input.eventId, handled);
  return pending.map((rule) => rule.id);
}

const types: Array<{ type: string; rules: Rule[] }> = [
  {
    type: "first_paid_purchase",
    rules: [
      { id: "fp-a", delayDays: 0, delayLess: true },
      { id: "fp-b", delayDays: 0, delayLess: true },
    ],
  },
  {
    type: "arbox_new_lead",
    rules: [
      { id: "nl-now", delayDays: 0, delayLess: false },
      { id: "nl-later", delayDays: 3, delayLess: false },
    ],
  },
  {
    type: "incoming_lead",
    rules: [
      { id: "in-now", delayDays: 0, delayLess: false },
      { id: "in-later", delayDays: 2, delayLess: false },
    ],
  },
  {
    type: "trial_booked",
    rules: [
      { id: "tb-a", delayDays: 0, delayLess: true },
      { id: "tb-b", delayDays: 0, delayLess: true },
    ],
  },
  {
    type: "class_cancelled_customer",
    rules: [
      { id: "cc-a", delayDays: 0, delayLess: true },
      { id: "cc-b", delayDays: 0, delayLess: true },
    ],
  },
];

for (const spec of types) {
  const log = new Map<string, Set<string>>();
  const first = run({ rules: spec.rules, eventId: "evt", offsetDays: 0, log });
  if (spec.rules.every((rule) => rule.delayLess || rule.delayDays === 0)) {
    assert.deepEqual(first, spec.rules.map((rule) => rule.id), `${spec.type} two rules send together`);
  } else {
    assert.deepEqual(
      first,
      spec.rules.filter((rule) => rule.delayDays === 0).map((rule) => rule.id),
      `${spec.type} only the due delay sends today`
    );
    const later = run({
      rules: spec.rules,
      eventId: "evt",
      offsetDays: spec.rules.find((rule) => rule.delayDays > 0)!.delayDays,
      log,
    });
    assert.deepEqual(
      later,
      spec.rules.filter((rule) => rule.delayDays > 0).map((rule) => rule.id),
      `${spec.type} the other delay sends on its own day`
    );
  }
  const again = run({ rules: spec.rules, eventId: "evt", offsetDays: 0, log });
  assert.deepEqual(again, [], `${spec.type} re-run does not resend`);

  const migrated = new Map<string, Set<string>>();
  const late = run({
    rules: spec.rules,
    eventId: "old",
    offsetDays: 0,
    log: migrated,
    preMigration: true,
  });
  assert.deepEqual(late, [], `${spec.type} pre-migration event is not resent after backfill`);
  if (spec.rules.some((rule) => rule.delayDays > 0)) {
    const lateDay = run({
      rules: spec.rules,
      eventId: "old",
      offsetDays: 3,
      log: migrated,
      preMigration: true,
    });
    assert.deepEqual(lateDay, [], `${spec.type} backfill covers the later delay too`);
  }
}

assert.deepEqual(backfillTriggerIdsForLiveRules([]), [SYNC_LOG_SENTINEL_TRIGGER_ID]);
assert.deepEqual(backfillTriggerIdsForLiveRules(["a", "a", "b"]), ["a", "b"]);

assert.equal(
  trialBookingTemplateFollowUp({
    confirmStatus: "sent",
    freeBlocked: false,
    templateNameConfigured: true,
    templateApproved: true,
  }),
  "skip"
);
assert.equal(
  trialBookingTemplateFollowUp({
    confirmStatus: "sent",
    freeBlocked: false,
    templateNameConfigured: true,
    templateApproved: true,
    templateBesidesFreeMessage: true,
  }),
  "send"
);

console.log("multi-rule-per-type.test.ts ok");
