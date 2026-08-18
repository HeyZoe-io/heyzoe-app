import assert from "node:assert/strict";
import { parseMetaWebhook } from "@/lib/whatsapp";
import {
  excerptForReactionQuote,
  foldConversationReactions,
  formatWaReactionLogContent,
  parseWaReactionLogContent,
  WA_UNSUPPORTED_REACTION_LOG,
} from "@/lib/wa-inbound-reaction";

assert.deepEqual(parseWaReactionLogContent("[unsupported] reaction"), { emoji: "", quoted: "" });
assert.deepEqual(parseWaReactionLogContent("[reaction] 👍"), { emoji: "👍", quoted: "" });
assert.deepEqual(parseWaReactionLogContent("[reaction] 👍\nמעולה, תודה שעדכנת אותי 🙂"), {
  emoji: "👍",
  quoted: "מעולה, תודה שעדכנת אותי 🙂",
});
assert.equal(parseWaReactionLogContent("שלום"), null);

assert.equal(
  formatWaReactionLogContent("👍", "מעולה, תודה שעדכנת אותי 🙂"),
  "[reaction] 👍\nמעולה, תודה שעדכנת אותי 🙂"
);
assert.equal(formatWaReactionLogContent("", ""), WA_UNSUPPORTED_REACTION_LOG);

assert.equal(excerptForReactionQuote("[unsupported] reaction"), "");
assert.equal(excerptForReactionQuote("מעולה, תודה שעדכנת אותי 🙂").includes("מעולה"), true);

const folded = foldConversationReactions([
  { role: "assistant", content: "מעולה, תודה שעדכנת אותי 🙂" },
  { role: "user", content: "[unsupported] reaction" },
  { role: "user", content: "[reaction] ❤️\nמעולה, תודה שעדכנת אותי 🙂" },
]);
assert.equal(folded.length, 1);
assert.equal(folded[0]?.content, "מעולה, תודה שעדכנת אותי 🙂");
assert.equal(folded[0]?.reactionEmoji, "❤️");

const parsedReaction = parseMetaWebhook({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "1234567890" },
            contacts: [{ profile: { name: "Dana" } }],
            messages: [
              {
                from: "972501234567",
                id: "wamid.REACT1",
                type: "reaction",
                reaction: { emoji: "👍", message_id: "wamid.ORIG" },
              },
            ],
          },
        },
      ],
    },
  ],
});
assert.equal(parsedReaction?.type, "unsupported");
if (parsedReaction?.type === "unsupported") {
  assert.equal(parsedReaction.metaInboundType, "reaction");
  assert.equal(parsedReaction.reactionEmoji, "👍");
}

console.log("wa-inbound-reaction.test.ts: ok");
