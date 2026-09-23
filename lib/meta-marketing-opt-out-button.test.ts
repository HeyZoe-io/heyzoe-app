import assert from "node:assert/strict";
import {
  isMarketingOptOutButtonText,
  MARKETING_OPT_OUT_BUTTON_EN,
  MARKETING_OPT_OUT_BUTTON_HE,
  marketingOptOutButtonText,
  withMarketingOptOutButton,
} from "@/lib/meta-marketing-opt-out-button";

{
  assert.equal(marketingOptOutButtonText("he"), MARKETING_OPT_OUT_BUTTON_HE);
  assert.equal(marketingOptOutButtonText("en_US"), MARKETING_OPT_OUT_BUTTON_EN);
  assert.equal(isMarketingOptOutButtonText("הפסקת הודעות הקידום"), true);
  assert.equal(isMarketingOptOutButtonText("Stop promotions"), true);
  assert.equal(isMarketingOptOutButtonText("הסר"), false);
}

{
  const out = withMarketingOptOutButton(
    [{ type: "BODY", text: "היי {{1}}" }],
    "he"
  );
  assert.deepEqual(out[1], {
    type: "BUTTONS",
    buttons: [{ type: "QUICK_REPLY", text: MARKETING_OPT_OUT_BUTTON_HE }],
  });
}

{
  const out = withMarketingOptOutButton(
    [
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "כן" },
          { type: "URL", text: "לאתר", url: "https://heyzoe.ai" },
        ],
      },
    ],
    "he"
  );
  const buttons = (out[0] as { buttons: { text: string }[] }).buttons;
  assert.deepEqual(
    buttons.map((button) => button.text),
    ["כן", MARKETING_OPT_OUT_BUTTON_HE, "לאתר"]
  );
}

{
  const once = withMarketingOptOutButton([{ type: "BODY", text: "שלום" }], "he");
  const twice = withMarketingOptOutButton(once, "he");
  const buttons = (twice[1] as { buttons: unknown[] }).buttons;
  assert.equal(buttons.length, 1);
}

console.log("meta-marketing-opt-out-button.test.ts: ok");
