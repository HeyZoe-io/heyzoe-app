import assert from "node:assert/strict";
import {
  resolveTemplateFirstName,
  resolveTrialReminderFirstName,
} from "@/lib/template-first-name";

assert.equal(resolveTemplateFirstName({ full_name: "Eliav_yosef" }), null);
assert.equal(resolveTemplateFirstName({ full_name: "Studio Pixel" }), null);
assert.equal(resolveTemplateFirstName({ full_name: "קרבון גריפ" }), "קרבון");
assert.equal(resolveTemplateFirstName({ full_name: 'קרבון גריפ בע"מ' }), null);
assert.equal(resolveTemplateFirstName({ full_name: "קרבון גריפ בע״מ" }), null);
assert.equal(resolveTemplateFirstName({ full_name: "קרבון גריפ בע'מ" }), null);
assert.equal(resolveTemplateFirstName({ full_name: "קרבון גריפ בעמ" }), null);
assert.equal(resolveTemplateFirstName({ full_name: "משה כהן" }), "משה");
assert.equal(resolveTemplateFirstName({ full_name: "רחל" }), "רחל");
assert.equal(resolveTemplateFirstName({ full_name: "Amitay Klein" }), "Amitay");
assert.equal(resolveTemplateFirstName({ full_name: "rachel cohen" }), "Rachel");
assert.equal(resolveTemplateFirstName(null, "rachel"), "Rachel");
assert.equal(resolveTemplateFirstName({ full_name: "Rachel" }), "Rachel");
assert.equal(resolveTemplateFirstName({ full_name: "user123" }), null);

assert.equal(resolveTemplateFirstName({ full_name: "אייזן רחל" }, "רחל אייזן"), "רחל");
assert.equal(resolveTemplateFirstName({ full_name: "Studio Pixel" }, "דנה כהן"), "דנה");
assert.equal(resolveTemplateFirstName({ full_name: null }), null);
assert.equal(resolveTemplateFirstName({ full_name: "א" }), null);
assert.equal(
  resolveTemplateFirstName({ full_name: "שולמית" }, "shulamit.henn@gmail.con"),
  null
);
assert.equal(resolveTemplateFirstName({ full_name: "דרור" }, "iilan6857"), null);
assert.equal(resolveTemplateFirstName(null, "0501234567"), null);
assert.equal(resolveTemplateFirstName(null, "https://example.com"), null);
assert.equal(resolveTemplateFirstName({ full_name: "רחל" }), "רחל");

assert.equal(
  resolveTrialReminderFirstName({ full_name: "שולמית" }, "shulamit.henn@gmail.con"),
  "שולמית"
);
assert.equal(resolveTrialReminderFirstName({ full_name: "iilan6857" }, "iilan6857"), "🙂");
assert.equal(resolveTrialReminderFirstName(null, null), "🙂");
assert.equal(resolveTrialReminderFirstName(null, "rachel"), "Rachel");
assert.equal(resolveTrialReminderFirstName({ full_name: "משה כהן" }, ""), "משה");
assert.equal(resolveTemplateFirstName({ full_name: "בת חן כהן" }), "בת חן");
assert.equal(resolveTemplateFirstName(null, "בת חן כהן"), "בת חן");
assert.equal(resolveTemplateFirstName({ full_name: "בן ציון לוי" }), "בן ציון");
assert.equal(resolveTemplateFirstName({ full_name: "בתיה כהן" }), "בתיה");
assert.equal(resolveTemplateFirstName({ full_name: "בת" }), null);
assert.equal(resolveTemplateFirstName({ full_name: "משה" }, "בת"), null);
assert.equal(resolveTrialReminderFirstName({ full_name: "בת" }), "🙂");
assert.equal(resolveTrialReminderFirstName({ full_name: "בת חן" }, "בת"), "בת חן");
