import assert from "node:assert/strict";
import {
  previewFromWhatsappTemplateComponents,
  renderLeadTemplateMessageContent,
  resolveLeadTemplateDisplayContent,
} from "@/lib/lead-template";

const ARBOX_NEW_LEAD_COMPONENTS = [
  {
    type: "BODY",
    text: "תודה שהתעניינתם בLimitless!\nבואו נכיר :)\nלחצו על הכפתור👇",
  },
  {
    type: "BUTTONS",
    buttons: [{ type: "QUICK_REPLY", text: "בואו נתחיל!" }],
  },
];

{
  const preview = previewFromWhatsappTemplateComponents(ARBOX_NEW_LEAD_COMPONENTS);
  assert.equal(preview?.body.includes("Limitless"), true);
  assert.deepEqual(preview?.buttons, ["בואו נתחיל!"]);
}

{
  const text = renderLeadTemplateMessageContent("arbox_new_lead", {
    components: ARBOX_NEW_LEAD_COMPONENTS,
  });
  assert.match(text, /תודה שהתעניינתם בLimitless!/);
  assert.match(text, /\[כפתור: בואו נתחיל!\]/);
  assert.equal(text.includes("נשלח טמפלייט פתיחה"), false);
}

{
  const placeholder = "נשלח טמפלייט פתיחה (arbox_new_lead)";
  const text = resolveLeadTemplateDisplayContent(placeholder, {
    componentsByName: { arbox_new_lead: ARBOX_NEW_LEAD_COMPONENTS },
  });
  assert.match(text, /בואו נכיר/);
  assert.equal(resolveLeadTemplateDisplayContent(placeholder), placeholder);
}

console.log("lead-template.test.ts: ok");
