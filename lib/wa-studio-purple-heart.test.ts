import assert from "node:assert/strict";
import "@/lib/wa-message-log-als.server";
import { withWaMessageLogScope } from "@/lib/wa-message-log-context";
import {
  applyStudioPurpleHeartPolicy,
  applyStudioPurpleHeartPolicyDeep,
  shouldStripPurpleHearts,
  stripPurpleHearts,
} from "@/lib/wa-studio-purple-heart";

assert.equal(
  stripPurpleHearts("מצטערת לשמוע! 💜 אני מעבירה לצוות"),
  "מצטערת לשמוע! אני מעבירה לצוות"
);
assert.equal(stripPurpleHearts("לשמור לך מקום? 💜"), "לשמור לך מקום?");
assert.equal(stripPurpleHearts("בכל עת 💜 יש עוד משהו"), "בכל עת יש עוד משהו");
assert.equal(stripPurpleHearts("שלום 🙂"), "שלום 🙂");
assert.equal(stripPurpleHearts("💜\uFE0F בסוף"), "בסוף");

assert.equal(shouldStripPurpleHearts({ slug: "apex" }), true);
assert.equal(shouldStripPurpleHearts({ slug: "sanga" }), false);
assert.equal(shouldStripPurpleHearts({ fromNumber: "1059985637203946" }), true);
assert.equal(shouldStripPurpleHearts({ fromNumber: "+972 50-230-3044" }), true);
assert.equal(shouldStripPurpleHearts({ fromNumber: "123456" }), false);

assert.equal(
  applyStudioPurpleHeartPolicy("תודה 💜", { slug: "apex" }),
  "תודה"
);
assert.equal(
  applyStudioPurpleHeartPolicy("תודה 💜", { slug: "sanga" }),
  "תודה 💜"
);

const interactive = applyStudioPurpleHeartPolicyDeep(
  { body: { text: "מצאתי! 💜 נתראה" }, footer: { text: "אנחנו כאן 💜" } },
  { slug: "apex" }
);
assert.deepEqual(interactive, {
  body: { text: "מצאתי! נתראה" },
  footer: { text: "אנחנו כאן" },
});

async function main() {
  await withWaMessageLogScope({ businessSlug: "apex", sessionId: "wa_apex_test" }, async () => {
    assert.equal(shouldStripPurpleHearts(), true);
    assert.equal(applyStudioPurpleHeartPolicy("כאן 💜"), "כאן");
  });

  await withWaMessageLogScope({ businessSlug: "sanga", sessionId: "wa_sanga_test" }, async () => {
    assert.equal(shouldStripPurpleHearts(), false);
    assert.equal(applyStudioPurpleHeartPolicy("כאן 💜"), "כאן 💜");
  });

  console.log("wa-studio-purple-heart.test.ts: ok");
}

void main();
