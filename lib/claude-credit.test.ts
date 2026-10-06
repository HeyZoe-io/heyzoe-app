import assert from "node:assert/strict";
import { isAnthropicCreditExhausted } from "@/lib/claude";

assert.equal(isAnthropicCreditExhausted({ status: 402, message: "Payment Required" }), true);
assert.equal(
  isAnthropicCreditExhausted(
    new Error("400 Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.")
  ),
  true
);
assert.equal(isAnthropicCreditExhausted(new Error("529 overloaded")), false);
assert.equal(isAnthropicCreditExhausted(new Error("Missing GEMINI_API_KEY")), false);

console.log("claude-credit: ok");
