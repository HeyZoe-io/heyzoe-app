import assert from "node:assert/strict";
import { alertMuteMatches, graphTemplateMessageId } from "@/lib/contact-alert-mute";
import {
  isTriggerAlertMuteButtonText,
  TRIGGER_ALERT_MUTE_BUTTON_HE,
  withTriggerAlertMuteButton,
} from "@/lib/meta-trigger-alert-mute-button";
import { MARKETING_OPT_OUT_BUTTON_HE, withMarketingOptOutButton } from "@/lib/meta-marketing-opt-out-button";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { decideScheduledSendAfterMeta } from "@/lib/scheduled-template-sends";

{
  assert.equal(isTriggerAlertMuteButtonText("הפסק התראה"), true);
  assert.equal(isTriggerAlertMuteButtonText("Stop this alert"), true);
  assert.equal(isTriggerAlertMuteButtonText("הפסקת הודעות הקידום"), false);
}

{
  const out = withMarketingOptOutButton(
    withTriggerAlertMuteButton(
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
    ),
    "he"
  );
  const buttons = (out[0] as { buttons: { text: string }[] }).buttons;
  assert.deepEqual(
    buttons.map((button) => button.text),
    ["כן", TRIGGER_ALERT_MUTE_BUTTON_HE, MARKETING_OPT_OUT_BUTTON_HE, "לאתר"]
  );
}

{
  const rows = [
    { trigger_id: "trig-birthday", template_name: null },
    { trigger_id: null, template_name: "sign_up_to_class" },
  ];
  assert.equal(
    alertMuteMatches({ rows, triggerId: "trig-birthday", templateName: "birthday_he" }),
    true
  );
  assert.equal(
    alertMuteMatches({ rows, triggerId: "trig-other", templateName: "birthday_he" }),
    false
  );
  assert.equal(
    alertMuteMatches({ rows, triggerId: null, templateName: "sign_up_to_class" }),
    true
  );
  assert.equal(
    alertMuteMatches({ rows, triggerId: "trig-other", templateName: "sign_up_to_class" }),
    false
  );
}

{
  assert.equal(graphTemplateMessageId({ messages: [{ id: "wamid.1" }] }), "wamid.1");
  assert.equal(graphTemplateMessageId({}), null);
  assert.equal(templateFailureDispatch("suppressed_alert_mute"), "gated");
  const after = decideScheduledSendAfterMeta({ ok: false, error: "suppressed_alert_mute" });
  assert.equal(after.status, "canceled");
}

console.log("contact-alert-mute.test.ts: ok");
