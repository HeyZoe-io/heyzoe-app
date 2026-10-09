import assert from "node:assert/strict";
import { estimateCostUsd } from "@/lib/ai-pricing";
import { groupRawAiUsageRows } from "@/lib/ai-usage-aggregate";

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

near(estimateCostUsd("claude-haiku-4-5", 1000, 200), 0.002);
near(estimateCostUsd("claude-haiku-5-5", 1000, 200), 0.0002);
near(estimateCostUsd("claude-haiku-5-5", 100_000, 0), 0.01);
near(estimateCostUsd("claude-haiku-5-5", 100_001, 10), 0.0500255);
near(estimateCostUsd("gemini-2.5-flash", 1_000_000, 0), 0.3);
near(estimateCostUsd("claude-sonnet-4-6", 0, 1_000_000), 15);

const flat = groupRawAiUsageRows(
  [
    {
      business_id: 1,
      created_at: "2026-10-09T10:00:00.000Z",
      model: "claude-haiku-4-5",
      call_type: "generation",
      input_tokens: 1000,
      output_tokens: 200,
    },
    {
      business_id: 1,
      created_at: "2026-10-09T11:00:00.000Z",
      model: "claude-haiku-4-5",
      call_type: "generation",
      input_tokens: 3000,
      output_tokens: 100,
    },
  ],
  "total"
);
assert.equal(flat.length, 1);
assert.equal(flat[0]?.costUsd, undefined);
assert.equal(flat[0]?.input_tokens, 4000);
near(estimateCostUsd("claude-haiku-4-5", 4000, 300), 0.0055);

const tiered = groupRawAiUsageRows(
  [
    {
      business_id: 2,
      created_at: "2026-10-09T10:00:00.000Z",
      model: "claude-haiku-5-5",
      call_type: "generation",
      input_tokens: 60_000,
      output_tokens: 100,
    },
    {
      business_id: 2,
      created_at: "2026-10-09T11:00:00.000Z",
      model: "claude-haiku-5-5",
      call_type: "generation",
      input_tokens: 60_000,
      output_tokens: 100,
    },
  ],
  "total"
);
assert.equal(tiered[0]?.input_tokens, 120_000);
near(tiered[0]?.costUsd ?? -1, 0.0121);
assert.notEqual(tiered[0]?.costUsd, estimateCostUsd("claude-haiku-5-5", 120_000, 200));

console.log("ai-pricing.test.ts: ok");
