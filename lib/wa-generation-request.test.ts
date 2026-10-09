import assert from "node:assert/strict";
import { buildWhatsAppGenerationParams, resolveWhatsAppGenerationModel } from "@/lib/claude";

function keys(value: object): string[] {
  return Object.keys(value).sort();
}

const haiku55 = buildWhatsAppGenerationParams("claude-haiku-5-5");
assert.deepEqual(haiku55, {
  model: "claude-haiku-5-5",
  max_tokens: 4096,
  output_config: { effort: "low" },
});
assert.deepEqual(keys(haiku55), ["max_tokens", "model", "output_config"]);
assert.equal("temperature" in haiku55, false);
assert.equal("top_p" in haiku55, false);
assert.equal("top_k" in haiku55, false);
assert.equal("thinking" in haiku55, false);

const haiku45 = buildWhatsAppGenerationParams("claude-haiku-4-5");
assert.deepEqual(haiku45, { model: "claude-haiku-4-5", max_tokens: 768 });
assert.deepEqual(keys(haiku45), ["max_tokens", "model"]);
assert.equal("temperature" in haiku45, false);
assert.equal("output_config" in haiku45, false);
assert.equal("thinking" in haiku45, false);

assert.equal(resolveWhatsAppGenerationModel(""), "claude-haiku-5-5");
assert.equal(resolveWhatsAppGenerationModel("  claude-haiku-4-5  "), "claude-haiku-4-5");
assert.throws(() => resolveWhatsAppGenerationModel("claude-sonnet-4-6"), /CLAUDE_WHATSAPP_MODEL/);
assert.throws(() => buildWhatsAppGenerationParams("claude-sonnet-5-5"), /CLAUDE_WHATSAPP_MODEL/);

console.log("wa-generation-request.test.ts: ok");
