/**
 * מציאת Phone Number IDs מ-WABA ב-Meta Graph API.
 *
 * הרצה מתוך heyzoe-app:
 *   npm run wa:find-phone-id
 *   node --env-file=.env.local scripts/find_id.js
 *
 * משתני סביבה: WA_TOKEN (או WHATSAPP_TOKEN), WA_BUSINESS_ACCOUNT_ID
 */
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const axios = require("axios");

async function main() {
  const WA_TOKEN = (process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN || "").trim();
  const WA_BUSINESS_ACCOUNT_ID = String(process.env.WA_BUSINESS_ACCOUNT_ID ?? "").trim();

  if (!WA_TOKEN || !WA_BUSINESS_ACCOUNT_ID) {
    console.error("[WA FIND ID] Missing env vars.", {
      WA_TOKEN: WA_TOKEN ? "EXISTS" : "MISSING",
      WA_BUSINESS_ACCOUNT_ID: WA_BUSINESS_ACCOUNT_ID ? "EXISTS" : "MISSING",
    });
    console.error(
      '[WA FIND ID] Add to .env.local: WA_BUSINESS_ACCOUNT_ID="YOUR_WABA_ID" and WA_TOKEN or WHATSAPP_TOKEN'
    );
    process.exit(1);
  }

  const url = `https://graph.facebook.com/v21.0/${WA_BUSINESS_ACCOUNT_ID}/phone_numbers`;
  console.log("Full URL:", url);

  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: "Bearer " + WA_TOKEN,
      },
      timeout: 30_000,
      validateStatus: () => true,
    });

    console.log("[WA FIND ID] Response status:", res.status, res.statusText);
    console.log("[WA FIND ID] Response headers:", res.headers);
    console.log("[WA FIND ID] Response data:", JSON.stringify(res.data, null, 2));

    if (res.status >= 200 && res.status < 300) {
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      console.log(`\n[WA FIND ID] Phone numbers returned: ${list.length}`);
      for (const item of list) {
        console.log(
          "-",
          JSON.stringify(
            {
              id: item?.id,
              display_phone_number: item?.display_phone_number,
              verified_name: item?.verified_name,
              quality_rating: item?.quality_rating,
              code_verification_status: item?.code_verification_status,
              name_status: item?.name_status,
            },
            null,
            2
          )
        );
      }
      process.exit(0);
    }

    console.error("[WA FIND ID] Non-2xx response. Meta error (if any) is above.");
    process.exit(2);
  } catch (err) {
    console.error("[WA FIND ID] Axios/network error:", {
      message: err?.message,
      code: err?.code,
      name: err?.name,
    });
    if (err?.response) {
      console.error("[WA FIND ID] Error response status:", err.response.status);
      console.error("[WA FIND ID] Error response headers:", err.response.headers);
      console.error("[WA FIND ID] Error response data:", err.response.data);
    }
    process.exit(3);
  }
}

main();
