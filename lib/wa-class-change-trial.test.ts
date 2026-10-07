import assert from "node:assert/strict";
import { handleLeadHumanRequested } from "@/lib/human-requested";
import {
  contactHasFutureTrialBooking,
  trialClassStartIsFuture,
} from "@/lib/wa-class-change-trial";
import { buildReplyRoutePromptBlock } from "@/lib/wa-reply-route";
import {
  BOOKED_CLASS_MOVE_APP_REPLY,
  RESCHEDULE_MEMBER_BY_FLAG_MODEL,
  RESCHEDULE_UNKNOWN_TEAM_MODEL,
  RESCHEDULE_UNKNOWN_TEAM_REPLY,
  resolveClassCancelWithTrialGate,
  resolveRescheduleHintWithTrialGate,
  resolveRescheduleWithMemberFlag,
} from "@/lib/wa-registration-intent";

const GABI_CANCEL = "יש אפשרות לבטל את השיעור נסיון? שמתי לב שהזמנים של השיעורים לא מתאימים לי";
const GABI_FOLLOWUP = "8:30 זה מאוחר מידי כי אני מתחילה לעבוד ב9";
const TIGHTS_FACT =
  "ביטול/החלפת אימון ניתן לבצע עד 12 שעות לפני תחילת האימון. ביטול מאוחר יותר נחשב כאימון שנוצל. ניתן להיכנס לאפליקציה, לבטל את הרישום ואם רוצים להירשם לאימון חדש :)";
const FACT_SEND = {
  reply: TIGHTS_FACT,
  model: "closed_playbook_fact_class_cancel",
  notifyTeam: false,
};
const NOW = new Date("2026-10-07T13:42:00.000Z");

assert.match(buildReplyRoutePromptBlock(), new RegExp(GABI_CANCEL.replace(/[?]/g, "\\?")));
assert.match(buildReplyRoutePromptBlock(), /\[\[route:booking_change_trial\]\]/);

const gabiFirst = resolveClassCancelWithTrialGate({
  claudeSaysTrial: true,
  storedFutureTrial: false,
  current: FACT_SEND,
});
assert.equal(gabiFirst.reply, RESCHEDULE_UNKNOWN_TEAM_REPLY);
assert.equal(gabiFirst.model, "class_change_trial_team_handoff");
assert.equal(gabiFirst.notifyTeam, true);
assert.equal(gabiFirst.reply.includes("אפליקצ"), false);

const wordsAloneDoNotFlip = resolveClassCancelWithTrialGate({
  claudeSaysTrial: false,
  storedFutureTrial: false,
  current: FACT_SEND,
});
assert.equal(wordsAloneDoNotFlip.reply, TIGHTS_FACT);
assert.equal(wordsAloneDoNotFlip.model, "closed_playbook_fact_class_cancel");
assert.equal(wordsAloneDoNotFlip.notifyTeam, false);

const followUp = resolveRescheduleWithMemberFlag(GABI_FOLLOWUP, {
  arboxIsMember: false,
  claudeSaysTrial: false,
  storedFutureTrial: true,
});
assert.equal(followUp.reply, RESCHEDULE_UNKNOWN_TEAM_REPLY);
assert.equal(followUp.model, "class_change_trial_team_handoff");
assert.equal(followUp.notifyTeam, true);

const memberMove = resolveRescheduleWithMemberFlag("אפשר להזיז את האימון למחר?", {
  arboxIsMember: true,
  claudeSaysTrial: false,
  storedFutureTrial: false,
});
assert.equal(memberMove.reply, BOOKED_CLASS_MOVE_APP_REPLY);
assert.equal(memberMove.model, RESCHEDULE_MEMBER_BY_FLAG_MODEL);
assert.equal(memberMove.notifyTeam, false);

const trialBeatsMemberFact = resolveRescheduleWithMemberFlag("אפשר להזיז את האימון למחר?", {
  arboxIsMember: true,
  claudeSaysTrial: true,
  storedFutureTrial: false,
  knowledge: {
    botName: "זואי",
    knowledgeQa: [{ question: "החלפת שיעור", answer: TIGHTS_FACT }],
  },
});
assert.equal(trialBeatsMemberFact.reply, RESCHEDULE_UNKNOWN_TEAM_REPLY);
assert.equal(trialBeatsMemberFact.model, "class_change_trial_team_handoff");

const unknownCancel = resolveClassCancelWithTrialGate({
  claudeSaysTrial: false,
  storedFutureTrial: false,
  current: FACT_SEND,
});
assert.equal(unknownCancel.reply, TIGHTS_FACT);
assert.equal(unknownCancel.notifyTeam, false);

const unknownReschedule = resolveRescheduleWithMemberFlag("אפשר להזיז את האימון למחר?", {
  arboxIsMember: false,
  claudeSaysTrial: false,
  storedFutureTrial: false,
});
assert.equal(unknownReschedule.reply, RESCHEDULE_UNKNOWN_TEAM_REPLY);
assert.equal(unknownReschedule.model, RESCHEDULE_UNKNOWN_TEAM_MODEL);
assert.equal(unknownReschedule.notifyTeam, true);

const unknownRescheduleHint = resolveRescheduleHintWithTrialGate({
  claudeSaysTrial: false,
  storedFutureTrial: false,
  arboxIsMember: false,
  memberReply: { reply: TIGHTS_FACT, model: "closed_playbook_fact_reschedule", notifyTeam: false },
});
assert.equal(unknownRescheduleHint.reply, RESCHEDULE_UNKNOWN_TEAM_REPLY);
assert.equal(unknownRescheduleHint.model, RESCHEDULE_UNKNOWN_TEAM_MODEL);

const memberRescheduleHint = resolveRescheduleHintWithTrialGate({
  claudeSaysTrial: false,
  storedFutureTrial: false,
  arboxIsMember: true,
  memberReply: { reply: TIGHTS_FACT, model: "closed_playbook_fact_reschedule", notifyTeam: false },
});
assert.equal(memberRescheduleHint.reply, TIGHTS_FACT);
assert.equal(memberRescheduleHint.model, "closed_playbook_fact_reschedule");

assert.equal(trialClassStartIsFuture("2026-10-09", "08:30", NOW), true);
assert.equal(trialClassStartIsFuture("2026-10-05", "08:30", NOW), false);
assert.equal(trialClassStartIsFuture("2026-10-07", "08:30", NOW), false);
assert.equal(trialClassStartIsFuture("2026-10-07", "18:00", NOW), true);

function identityQuery(rows: Array<{ class_date: string; class_time: string }>) {
  const filters: string[] = [];
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push(`${column}=${String(value)}`);
      return api;
    },
    gte(column: string, value: string) {
      filters.push(`${column}>=${value}`);
      return api;
    },
    async limit() {
      return { data: rows, error: null };
    },
  };
  return {
    filters,
    from(table: string) {
      filters.push(table);
      return api;
    },
  };
}

async function main() {
const pastOnly = identityQuery([{ class_date: "2026-10-07", class_time: "08:30" }]);
assert.equal(
  await contactHasFutureTrialBooking({
    admin: pastOnly as never,
    businessId: 3543,
    userId: 11636099,
    now: NOW,
  }),
  false
);
assert.equal(pastOnly.filters.includes("business_id=3543"), true);
assert.equal(pastOnly.filters.includes("user_id=11636099"), true);
assert.equal(pastOnly.filters.includes("classification=trial"), true);

const futureRow = identityQuery([{ class_date: "2026-10-09", class_time: "08:30" }]);
assert.equal(
  await contactHasFutureTrialBooking({
    admin: futureRow as never,
    businessId: 3543,
    userId: 11636099,
    now: NOW,
  }),
  true
);

type Row = { human_requested_at?: string | null };
function contactQuery(row: Row | null, onUpdate?: () => void) {
  const api = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    in() {
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    is() {
      return api;
    },
    update() {
      onUpdate?.();
      return api;
    },
    async maybeSingle() {
      return { data: row, error: null };
    },
    then(resolve: (value: { data: { id: string }[] | null; error: null }) => void) {
      resolve({ data: row?.human_requested_at ? [] : [], error: null });
    },
  };
  return { from: () => api };
}

let writes = 0;
const first = await handleLeadHumanRequested({
  supabase: contactQuery({ human_requested_at: null }, () => {
    writes += 1;
  }) as never,
  businessId: 3543,
  businessSlug: "tights",
  phone: "972528613214",
  nowIso: "2026-10-07T13:43:16.000Z",
  sessionId: "wa_1322271104298073_972528613214",
});
const second = await handleLeadHumanRequested({
  supabase: contactQuery({ human_requested_at: "2026-10-07T13:43:16.000Z" }, () => {
    writes += 1;
  }) as never,
  businessId: 3543,
  businessSlug: "tights",
  phone: "972528613214",
  nowIso: "2026-10-07T13:43:24.000Z",
  sessionId: "wa_1322271104298073_972528613214",
});
assert.equal(first.already, true);
assert.equal(second.already, true);
assert.equal(writes, 1);

console.log("wa-class-change-trial.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
