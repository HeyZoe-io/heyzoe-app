import assert from "node:assert/strict";
import { dashboardSettingsI18n } from "@/lib/dashboard-settings-i18n";
import { whatsAppPrefilledMessageHref } from "@/lib/dashboard-wa-send-href";

const hePrefill = dashboardSettingsI18n.he.page.waPrefill;
assert.equal(hePrefill, "אשמח לפרטים");
assert.notEqual(hePrefill, "היי");

const href = whatsAppPrefilledMessageHref("0501234567", hePrefill);
assert.equal(
  href,
  `https://wa.me/972501234567?text=${encodeURIComponent("אשמח לפרטים")}`
);
assert.ok(href && href.includes("text=%D7%90%D7%A9%D7%9E%D7%97%20%D7%9C%D7%A4%D7%A8%D7%98%D7%99%D7%9D"));
assert.equal(href?.includes("היי"), false);
assert.equal(href?.includes("אשמח"), false, "Hebrew must be URL-encoded, not raw");

console.log("dashboard-wa-send-href.test.ts: ok");
