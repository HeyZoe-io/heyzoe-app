import assert from "node:assert/strict";
import {
  defaultSalesFlowConfig,
  formatSalesFlowForPrompt,
  normalizeScheduleBoardCaption,
  parseSalesFlowFromSocial,
  resolveScheduleBoardCaption,
  SCHEDULE_BOARD_CAPTION,
  serializeSalesFlowConfig,
} from "@/lib/sales-flow";
import { localizeSalesFlowConfigWithDictionaryOnly } from "@/lib/sales-flow-localize";

assert.equal(resolveScheduleBoardCaption(null), SCHEDULE_BOARD_CAPTION);
assert.equal(resolveScheduleBoardCaption({ schedule_board_caption: "  " }), SCHEDULE_BOARD_CAPTION);
assert.equal(resolveScheduleBoardCaption({ schedule_board_caption: "הלוח שלנו" }), "הלוח שלנו");
assert.equal(
  resolveScheduleBoardCaption({ schedule_board_caption: "הלוח שלנו" }, "אפשר לראות במערכת שעות!"),
  "הלוח שלנו"
);
assert.equal(
  resolveScheduleBoardCaption(undefined, "אפשר לראות במערכת שעות! זה עונה על השאלה שלך?"),
  "אפשר לראות במערכת שעות! זה עונה על השאלה שלך?"
);

assert.equal(normalizeScheduleBoardCaption(SCHEDULE_BOARD_CAPTION), undefined);
assert.equal(normalizeScheduleBoardCaption("  הלוח שלנו  "), "הלוח שלנו");

const untouched = parseSalesFlowFromSocial({});
assert.equal(untouched?.schedule_board_caption, undefined);
assert.equal(serializeSalesFlowConfig(defaultSalesFlowConfig([])).schedule_board_caption, undefined);

const saved = parseSalesFlowFromSocial({ schedule_board_caption: "הלוח המעודכן שלנו" });
assert.equal(saved?.schedule_board_caption, "הלוח המעודכן שלנו");
const roundTrip = parseSalesFlowFromSocial(
  serializeSalesFlowConfig({ ...defaultSalesFlowConfig([]), schedule_board_caption: "הלוח המעודכן שלנו" })
);
assert.equal(roundTrip?.schedule_board_caption, "הלוח המעודכן שלנו");

const defaultRoundTrip = parseSalesFlowFromSocial(
  serializeSalesFlowConfig({
    ...defaultSalesFlowConfig([]),
    schedule_board_caption: SCHEDULE_BOARD_CAPTION,
  })
);
assert.equal(defaultRoundTrip?.schedule_board_caption, undefined);

const prompt = formatSalesFlowForPrompt(
  { ...defaultSalesFlowConfig([]), schedule_board_caption: "הלוח המעודכן שלנו" },
  [],
  new Map()
);
assert.match(prompt, /הלוח המעודכן שלנו/);
const defaultPrompt = formatSalesFlowForPrompt(defaultSalesFlowConfig([]), [], new Map());
assert.doesNotMatch(defaultPrompt, /הכיתוב שנשלח עם מערכת השעות/);

const localized = localizeSalesFlowConfigWithDictionaryOnly(
  { ...defaultSalesFlowConfig([]), schedule_board_caption: SCHEDULE_BOARD_CAPTION },
  new Set(),
  "en"
);
assert.equal(localized.schedule_board_caption, "Here's our class schedule");

console.log("schedule-board-caption.test.ts: ok");
