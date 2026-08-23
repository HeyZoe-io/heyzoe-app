import assert from "node:assert/strict";
import {
  DASHBOARD_WA_SEND_PREFILL,
  DASHBOARD_WA_SEND_PREFILL_QUERY,
  dashboardWhatsAppSendHref,
} from "@/lib/dashboard-wa-send-href";

assert.equal(DASHBOARD_WA_SEND_PREFILL, "אשמח לפרטים");
assert.notEqual(DASHBOARD_WA_SEND_PREFILL, "היי");
assert.equal(encodeURIComponent(DASHBOARD_WA_SEND_PREFILL), DASHBOARD_WA_SEND_PREFILL_QUERY);

assert.equal(
  dashboardWhatsAppSendHref("97233823805"),
  "https://wa.me/97233823805?text=%D7%90%D7%A9%D7%9E%D7%97%20%D7%9C%D7%A4%D7%A8%D7%98%D7%99%D7%9D"
);
assert.equal(
  dashboardWhatsAppSendHref("033823805"),
  "https://wa.me/97233823805?text=%D7%90%D7%A9%D7%9E%D7%97%20%D7%9C%D7%A4%D7%A8%D7%98%D7%99%D7%9D"
);

const href = dashboardWhatsAppSendHref("0501234567");
assert.equal(
  href,
  `https://wa.me/972501234567?text=${DASHBOARD_WA_SEND_PREFILL_QUERY}`
);
assert.equal(href?.includes("היי"), false);
assert.equal(href?.includes("אשמח"), false, "Hebrew must be URL-encoded, not raw");

console.log("dashboard-wa-send-href.test.ts: ok");
