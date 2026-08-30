import assert from "node:assert/strict";
import {
  preserveSalesFlowExtraSteps,
  preserveSalesFlowExtraStepsInSocial,
  settingsUpdatedAtConflicts,
} from "@/lib/dashboard-settings-save-guard";
import { defaultSalesFlowConfig, serializeSalesFlowConfig } from "@/lib/sales-flow";

const greetingExtras = [
  {
    id: "g1",
    question: "מה מעניין אותך?",
    options: ["כוח", "גמישות"],
    replies: ["מעולה", "נהדר"],
  },
];
const ctaExtras = [
  {
    id: "c1",
    question: "רוצה לשמוע על מנוי?",
    options: ["כן", "לא"],
    replies: ["סבבה", "אין בעיה"],
  },
];

const emptyIncoming = {
  greeting_opener: "היי",
  greeting_extra_steps: [],
  cta_extra_steps: [],
  cta_body: "לשמור מקום?",
};
const previous = {
  greeting_opener: "היי ישן",
  greeting_extra_steps: greetingExtras,
  cta_extra_steps: ctaExtras,
  cta_body: "ישן",
};

const preserved = preserveSalesFlowExtraSteps(emptyIncoming, previous);
assert.deepEqual(preserved.greeting_extra_steps, greetingExtras);
assert.deepEqual(preserved.cta_extra_steps, ctaExtras);
assert.equal(preserved.cta_body, "לשמור מקום?");

const explicit = preserveSalesFlowExtraSteps(
  {
    greeting_extra_steps: [{ id: "new", question: "שאלה חדשה?", options: ["א", "ב"], replies: ["1", "2"] }],
    cta_extra_steps: [],
  },
  previous
);
assert.equal((explicit.greeting_extra_steps as { question: string }[])[0]?.question, "שאלה חדשה?");
assert.deepEqual(explicit.cta_extra_steps, ctaExtras);

const social = preserveSalesFlowExtraStepsInSocial(
  { sales_flow: { ...emptyIncoming }, tagline: "x" },
  { sales_flow: previous }
);
const socialSf = social.sales_flow as Record<string, unknown>;
assert.deepEqual(socialSf.greeting_extra_steps, greetingExtras);
assert.deepEqual(socialSf.cta_extra_steps, ctaExtras);

const cfg = defaultSalesFlowConfig([]);
cfg.greeting_extra_steps = greetingExtras.map((s) => ({ ...s, options: [...s.options], replies: [...s.replies] }));
cfg.cta_extra_steps = ctaExtras.map((s) => ({ ...s, options: [...s.options], replies: [...s.replies] }));
const serialized = serializeSalesFlowConfig(cfg);
assert.equal((serialized.greeting_extra_steps as unknown[]).length, 1);
assert.equal((serialized.cta_extra_steps as unknown[]).length, 1);
assert.equal((serialized.greeting_extra_steps as { question: string }[])[0]?.question, "מה מעניין אותך?");

assert.equal(settingsUpdatedAtConflicts("2026-08-24T10:00:00.000Z", "2026-08-24T10:00:00.000Z"), false);
assert.equal(settingsUpdatedAtConflicts("2026-08-24T10:00:00.000Z", "2026-08-24T10:00:00Z"), false);
assert.equal(settingsUpdatedAtConflicts("2026-08-24T10:00:00.000Z", "2026-08-24T11:00:00.000Z"), true);
assert.equal(settingsUpdatedAtConflicts("", "2026-08-24T10:00:00.000Z"), true);
assert.equal(settingsUpdatedAtConflicts("2026-08-24T10:00:00.000Z", ""), false);
assert.equal(settingsUpdatedAtConflicts(undefined, "2026-08-24T10:00:00.000Z"), true);

console.log("dashboard-settings-save-guard.test.ts: ok");
