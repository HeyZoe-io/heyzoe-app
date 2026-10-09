import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHaikuRequest,
  buildWhatsAppGenerationParams,
  claudeTextBlocks,
  readHaikuText,
  resolveAllowedHaikuModel,
} from "@/lib/ai-models";

function keys(value: object): string[] {
  return Object.keys(value).sort();
}

const generation55 = buildWhatsAppGenerationParams("claude-haiku-5-5");
assert.deepEqual(generation55, {
  model: "claude-haiku-5-5",
  max_tokens: 4096,
  output_config: { effort: "low" },
});
assert.equal("temperature" in generation55, false);
assert.equal("thinking" in generation55, false);

const generation45 = buildWhatsAppGenerationParams("claude-haiku-4-5");
assert.deepEqual(generation45, { model: "claude-haiku-4-5", max_tokens: 768 });

const reply55 = buildHaikuRequest("conversation-flow-free-question", "claude-haiku-5-5");
assert.deepEqual(reply55, generation55);
const reply45 = buildHaikuRequest("conversation-flow-free-question", "claude-haiku-4-5");
assert.deepEqual(reply45, { model: "claude-haiku-4-5", max_tokens: 280, temperature: 0.3 });

const classify55 = buildHaikuRequest("not-relevant-location", "claude-haiku-5-5");
assert.deepEqual(classify55, {
  model: "claude-haiku-5-5",
  max_tokens: 64,
  output_config: { effort: "low" },
  thinking: { type: "disabled" },
});
assert.equal("temperature" in classify55, false);
const classify45 = buildHaikuRequest("not-relevant-open-classify", "claude-haiku-4-5");
assert.deepEqual(classify45, { model: "claude-haiku-4-5", max_tokens: 8, temperature: 0 });

const transform55 = buildHaikuRequest("sales-flow-translate", "claude-haiku-5-5");
assert.equal(transform55.max_tokens, 3072);
assert.deepEqual(transform55.thinking, { type: "disabled" });
const transform45 = buildHaikuRequest("product-description", "claude-haiku-4-5");
assert.deepEqual(transform45, { model: "claude-haiku-4-5", max_tokens: 768 });
assert.deepEqual(keys(transform45), ["max_tokens", "model"]);

const extract55 = buildHaikuRequest("fetch-site-scan", "claude-haiku-5-5");
assert.equal(extract55.max_tokens, 8192);
assert.equal(extract55.output_config?.effort, "low");
assert.equal("thinking" in extract55, false);
assert.equal(buildHaikuRequest("fetch-site-scan-fallback", "claude-haiku-5-5").max_tokens, 5632);
assert.equal(buildHaikuRequest("fetch-site-enrich", "claude-haiku-5-5").max_tokens, 6144);
assert.deepEqual(buildHaikuRequest("fetch-site-scan", "claude-haiku-4-5"), {
  model: "claude-haiku-4-5",
  max_tokens: 4096,
});

const joined = claudeTextBlocks({
  content: [
    { type: "thinking", thinking: "hidden" },
    { type: "text", text: "YES" },
  ],
});
assert.equal(joined, "YES");

const capped = readHaikuText("not-relevant-location", {
  stop_reason: "max_tokens",
  content: [{ type: "text", text: "מי" }],
});
assert.equal(capped.truncated, true);
assert.equal(capped.text, "מי");

assert.throws(() => resolveAllowedHaikuModel("CLAUDE_HAIKU_MODEL", "claude-sonnet-4-6"), /CLAUDE_HAIKU_MODEL/);
assert.equal(resolveAllowedHaikuModel("CLAUDE_HAIKU_MODEL", ""), "claude-haiku-5-5");

const evalFiles = [
  "scripts/eval-schedule-source.ts",
  "scripts/eval-fast-path-hints.ts",
  "scripts/eval-pre-claude-incidents.ts",
  "scripts/eval-wa-reply-route.ts",
  "scripts/eval-wa-hebrew-model-compare.ts",
];
for (const file of evalFiles) {
  const src = readFileSync(file, "utf8");
  assert.equal(src.includes("CLAUDE_WHATSAPP_MODEL"), false, file);
  assert.equal(src.includes('model: "claude-haiku-4-5"') || src.includes('model: "claude-haiku-4-5",'), true, file);
}

console.log("ai-models.test.ts: ok");
