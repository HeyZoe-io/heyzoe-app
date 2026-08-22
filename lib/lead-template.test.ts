import assert from "node:assert/strict";
import {
  previewFromWhatsappTemplateComponents,
  renderLeadTemplateMessageContent,
  resolveLeadTemplateDisplayContent,
} from "@/lib/lead-template";

const ARBOX_NEW_LEAD_COMPONENTS = [
  {
    type: "BODY",
    text: "ברוכים הבאים ל - Limitless!\nבואו נמצא את האימון המושלם בשבילכם!\nלחצו על הכפתור👇",
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
  assert.match(text, /ברוכים הבאים ל - Limitless!/);
  assert.match(text, /\[כפתור: בואו נתחיל!\]/);
  assert.equal(text.includes("נשלח טמפלייט פתיחה"), false);
}

{
  const placeholder = "נשלח טמפלייט פתיחה (arbox_new_lead)";
  const text = resolveLeadTemplateDisplayContent(placeholder, {
    componentsByName: { arbox_new_lead: ARBOX_NEW_LEAD_COMPONENTS },
  });
  assert.match(text, /האימון המושלם/);
  assert.equal(resolveLeadTemplateDisplayContent(placeholder), placeholder);
}

{
  const live = [
    { type: "HEADER", format: "TEXT", text: "היי! כאן סאנגה יוגה" },
    {
      type: "BODY",
      text: "מתלבטים אם לתרגל איתנו יוגה?\n3 שאלות כדי שנתאים לכם את האימון המושלם!\nקליק👇",
    },
    { type: "FOOTER", text: "דם המכבים 36 מודיעין" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "בואו נתחיל!" }] },
  ];
  const text = renderLeadTemplateMessageContent("sanga_quiz_welcome", {
    components: live,
  });
  assert.match(text, /3 שאלות כדי שנתאים לכם את האימון המושלם/);
  assert.equal(text.includes("5 שאלות"), false);
  assert.equal(text.includes("להתחיל לתרגל"), false);
}

console.log("lead-template.test.ts: ok");
