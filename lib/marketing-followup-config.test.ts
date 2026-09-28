import assert from "node:assert/strict";
import {
  DEFAULT_MARKETING_FOLLOWUP_CONFIG,
  marketingFollowupDelaysMs,
  marketingFollowupEnabled,
  resolveMarketingFollowupConfig,
  validateMarketingFollowupConfig,
} from "@/lib/marketing-followup-config";
import {
  pickMarketingFollowupSkipReason,
  pickMarketingFollowupStage,
  type MarketingFlowSessionFollowupRow,
} from "@/lib/marketing-followups";
import {
  isAllowedWhatsAppSendTimeIsrael,
  WA_ISRAEL_FRIDAY_BLOCK_START_MINUTES,
  WA_ISRAEL_QUIET_END_MINUTES,
  WA_ISRAEL_QUIET_START_MINUTES,
  WA_ISRAEL_SATURDAY_RESUME_MINUTES,
} from "@/lib/israel-time";

const baseRow: MarketingFlowSessionFollowupRow = {
  id: "s1",
  phone: "972500000000",
  last_user_message_at: new Date(0).toISOString(),
  followup_1_sent_at: null,
  followup_2_sent_at: null,
  followup_3_sent_at: null,
  followup_opted_out: false,
  flow_completed: false,
};

function rowAt(elapsedMs: number, patch: Partial<MarketingFlowSessionFollowupRow> = {}): MarketingFlowSessionFollowupRow {
  return {
    ...baseRow,
    last_user_message_at: new Date(1_000_000 - elapsedMs).toISOString(),
    ...patch,
  };
}

const now = 1_000_000;
const defaults = marketingFollowupDelaysMs(DEFAULT_MARKETING_FOLLOWUP_CONFIG);

assert.equal(defaults[0], 10 * 60 * 1000);
assert.equal(defaults[1], 2 * 60 * 60 * 1000);
assert.equal(defaults[2], 23 * 60 * 60 * 1000);

assert.equal(pickMarketingFollowupStage(rowAt(defaults[0] - 1), now), 0);
assert.equal(pickMarketingFollowupStage(rowAt(defaults[0]), now), 1);
assert.equal(pickMarketingFollowupStage(rowAt(defaults[1]), now, defaults, [false, true, true]), 2);
assert.equal(
  pickMarketingFollowupStage(rowAt(defaults[2]), now, defaults, [true, true, true],),
  1
);
assert.equal(
  pickMarketingFollowupStage(
    rowAt(defaults[2], { followup_1_sent_at: new Date().toISOString(), followup_2_sent_at: new Date().toISOString() }),
    now
  ),
  3
);
assert.equal(
  pickMarketingFollowupSkipReason(rowAt(defaults[0] - 1), now),
  "not_due_yet"
);
assert.equal(
  pickMarketingFollowupSkipReason(rowAt(defaults[2]), now, defaults, [false, false, false]),
  "stages_disabled"
);

const custom = validateMarketingFollowupConfig({
  stages: [
    { delay_minutes: 15, text: "א", enabled: true },
    { delay_minutes: 90, text: "ב", enabled: true },
    { delay_minutes: 200, text: "ג", enabled: false },
  ],
});
assert.equal(custom.ok, true);
if (custom.ok) {
  const delays = marketingFollowupDelaysMs(custom.config);
  const enabled = marketingFollowupEnabled(custom.config);
  assert.equal(pickMarketingFollowupStage(rowAt(15 * 60 * 1000), now, delays, enabled), 1);
  assert.equal(pickMarketingFollowupStage(rowAt(200 * 60 * 1000), now, delays, enabled), 1);
  assert.equal(
    pickMarketingFollowupStage(
      rowAt(200 * 60 * 1000, { followup_1_sent_at: "x", followup_2_sent_at: "x" }),
      now,
      delays,
      enabled
    ),
    0
  );
}

assert.equal(
  validateMarketingFollowupConfig({
    stages: [
      { delay_minutes: 120, text: "א", enabled: true },
      { delay_minutes: 10, text: "ב", enabled: true },
      { delay_minutes: 200, text: "ג", enabled: true },
    ],
  }).ok,
  false
);
assert.equal(resolveMarketingFollowupConfig({}).usingDefaults, true);
assert.equal(resolveMarketingFollowupConfig(null).usingDefaults, true);

assert.equal(WA_ISRAEL_QUIET_START_MINUTES, 23 * 60);
assert.equal(WA_ISRAEL_QUIET_END_MINUTES, 6 * 60 + 30);
assert.equal(WA_ISRAEL_FRIDAY_BLOCK_START_MINUTES, 16 * 60);
assert.equal(WA_ISRAEL_SATURDAY_RESUME_MINUTES, 19 * 60);

function israelLocal(weekday: number, hour: number, minute: number): Date {
  // 2026-03-01 is Sunday. weekday 0=Sun … 6=Sat.
  const day = 1 + weekday;
  const guess = new Date(Date.UTC(2026, 2, day, hour - 2, minute, 0));
  return guess;
}

assert.equal(isAllowedWhatsAppSendTimeIsrael(israelLocal(0, 10, 0)), true);
assert.equal(isAllowedWhatsAppSendTimeIsrael(israelLocal(0, 23, 0)), false);
assert.equal(isAllowedWhatsAppSendTimeIsrael(israelLocal(0, 6, 29)), false);
assert.equal(isAllowedWhatsAppSendTimeIsrael(israelLocal(0, 6, 30)), true);
assert.equal(isAllowedWhatsAppSendTimeIsrael(israelLocal(5, 15, 59)), true);
assert.equal(isAllowedWhatsAppSendTimeIsrael(israelLocal(5, 16, 0)), false);
assert.equal(isAllowedWhatsAppSendTimeIsrael(israelLocal(6, 18, 59)), false);
assert.equal(isAllowedWhatsAppSendTimeIsrael(israelLocal(6, 19, 0)), true);

console.log("marketing-followup-config.test.ts ok");
