/**
 * שליחת תבנית hello_world לבדיקת חיבור Meta WhatsApp.
 *
 * הרצה מתוך heyzoe-app:
 *   npm run wa:send-test
 *   node --env-file=.env.local scripts/send_test.js
 *
 * משתני סביבה: WA_TOKEN (או WHATSAPP_TOKEN), RECIPIENT_PHONE (9725… ללא +)
 * אופציונלי: WA_PHONE_NUMBER_ID, WA_BUSINESS_ACCOUNT_ID (ברירת מחדל — ערכים ישנים לבדיקה)
 */
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const axios = require("axios");

async function sendTemplate({ idLabel, idValue, token, body }) {
  const url = `https://graph.facebook.com/v21.0/${idValue}/messages`;

  console.log(`\n=== Trying with ${idLabel}... ===`);
  console.log("Full URL:", url);

  const res = await axios.post(url, body, {
    headers: {
      Authorization: "Bearer " + token.trim(),
      "Content-Type": "application/json",
    },
    timeout: 30_000,
    validateStatus: () => true,
  });

  console.log(`[WA TEST] Response status (${idLabel}):`, res.status, res.statusText);
  console.log(`[WA TEST] Response headers (${idLabel}):`, res.headers);
  console.log(`[WA TEST] Response data (${idLabel}):`, res.data);

  return res;
}

async function main() {
  const WA_TOKEN = (process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN || "").trim();
  const RECIPIENT_PHONE = String(process.env.RECIPIENT_PHONE ?? "").trim();

  if (!WA_TOKEN || !RECIPIENT_PHONE) {
    console.error("[WA TEST] Missing env vars.", {
      WA_TOKEN: WA_TOKEN ? "EXISTS" : "MISSING",
      RECIPIENT_PHONE: RECIPIENT_PHONE ? "EXISTS" : "MISSING",
    });
    console.error(
      '[WA TEST] Add to .env.local: RECIPIENT_PHONE="9725XXXXXXX" (your personal WhatsApp, no + sign)'
    );
    process.exit(1);
  }

  const PHONE_ID = String(process.env.WA_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || "338942595980181").trim();
  const BUSINESS_ID = String(process.env.WA_BUSINESS_ACCOUNT_ID || "414529741736731").trim();

  const body = {
    messaging_product: "whatsapp",
    to: RECIPIENT_PHONE,
    type: "template",
    template: {
      name: "hello_world",
      language: { code: "en_US" },
    },
  };

  console.log("[WA TEST] Request body:", JSON.stringify(body, null, 2));

  try {
    const resPhone = await sendTemplate({
      idLabel: "Phone ID",
      idValue: PHONE_ID,
      token: WA_TOKEN,
      body,
    });

    if (resPhone.status >= 200 && resPhone.status < 300) {
      console.log("[WA TEST] ✅ Message accepted by Meta.");
      process.exit(0);
    }

    const resBiz = await sendTemplate({
      idLabel: "Business ID",
      idValue: BUSINESS_ID,
      token: WA_TOKEN,
      body,
    });

    if (resBiz.status >= 200 && resBiz.status < 300) {
      console.log("[WA TEST] ✅ Message accepted by Meta (Business ID).");
      process.exit(0);
    }

    console.error("[WA TEST] ❌ Non-2xx response from Meta for both IDs.");
    process.exit(2);
  } catch (err) {
    console.error("[WA TEST] ❌ Axios/network error:", {
      message: err?.message,
      code: err?.code,
      name: err?.name,
    });
    if (err?.response) {
      console.error("[WA TEST] Error response status:", err.response.status);
      console.error("[WA TEST] Error response headers:", err.response.headers);
      console.error("[WA TEST] Error response data:", err.response.data);
    }
    process.exit(3);
  }
}

main();
