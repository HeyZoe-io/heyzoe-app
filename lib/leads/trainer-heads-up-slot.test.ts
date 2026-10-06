import assert from "node:assert/strict";
import {
  decideTrainerHeadsUpDelivery,
  trainerHeadsUpMatchesSlot,
} from "@/lib/leads/arbox-trainer-trial-heads-up";
import { trainerHeadsUpTemplateParamValues } from "@/lib/template-send-params";

const today = "2026-10-06";
const early = {
  classDateYmd: "2026-10-07",
  classTime: "08:30",
  todayYmd: today,
  delayDays: 0,
};

assert.equal(trainerHeadsUpMatchesSlot({ ...early, slot: "evening", bodyVarCount: 5 }), true);
assert.equal(trainerHeadsUpMatchesSlot({ ...early, slot: "morning", bodyVarCount: 5 }), false);
assert.equal(trainerHeadsUpMatchesSlot({ ...early, slot: "evening", bodyVarCount: 1 }), false);
assert.equal(
  trainerHeadsUpMatchesSlot({
    ...early,
    classDateYmd: today,
    slot: "morning",
    bodyVarCount: 1,
  }),
  true
);
assert.equal(
  trainerHeadsUpMatchesSlot({
    ...early,
    classDateYmd: today,
    slot: "morning",
    bodyVarCount: 5,
  }),
  false
);
assert.equal(
  trainerHeadsUpMatchesSlot({
    classDateYmd: "2026-10-07",
    classTime: "18:00",
    todayYmd: today,
    delayDays: 0,
    slot: "evening",
    bodyVarCount: 5,
  }),
  false
);

function body(text: string) {
  return [{ type: "BODY", text }];
}

assert.deepEqual(
  trainerHeadsUpTemplateParamValues({
    storedComponents: body("היום מגיע {{1}}"),
    className: "יוגה",
    classTime: "18:00",
    clientFullName: "דנה כהן",
    classDateYmd: "2026-10-07",
  }),
  { ok: true, values: ["יוגה"] }
);
assert.deepEqual(
  trainerHeadsUpTemplateParamValues({
    storedComponents: body("{{1}} {{2}} {{3}} {{4}} {{5}}"),
    className: "יוגה",
    classTime: "18:00",
    clientFullName: "דנה כהן",
    clientGeneralNotes: "",
    classDateYmd: "2026-10-07",
  }),
  { ok: true, values: ["יוגה", "18:00", "דנה כהן", "אין", "יום רביעי 7.10"] }
);
const bad = trainerHeadsUpTemplateParamValues({
  storedComponents: body("{{1}} {{2}}"),
  className: "יוגה",
});
assert.equal(bad.ok, false);

const morning = new Date("2026-10-07T06:00:00.000Z");
const legacy = body("היום מגיע אליך {{1}}");
const approved = body("{{1}} {{2}} {{3}} {{4}} {{5}}");
assert.equal(
  decideTrainerHeadsUpDelivery({
    storedComponents: legacy,
    classDateYmd: "2026-10-07",
    classTime: "20:00",
    now: morning,
  }),
  "hold"
);
assert.equal(
  decideTrainerHeadsUpDelivery({
    storedComponents: legacy,
    classDateYmd: "2026-10-07",
    classTime: "08:00",
    now: morning,
  }),
  "class_started"
);
assert.equal(
  decideTrainerHeadsUpDelivery({
    storedComponents: approved,
    classDateYmd: "2026-10-07",
    classTime: "16:00",
    now: morning,
  }),
  "send"
);
assert.equal(
  decideTrainerHeadsUpDelivery({
    storedComponents: approved,
    classDateYmd: "2026-10-07",
    classTime: "08:30",
    now: morning,
  }),
  "class_started"
);
