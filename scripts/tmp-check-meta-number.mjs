/**
 * זמני — בדיקת פרטי מספר WhatsApp ב-Meta Graph API.
 *
 * הרצה:
 *   node --env-file=.env.local scripts/tmp-check-meta-number.mjs
 *
 * טוקן: WHATSAPP_TOKEN → META_ACCESS_TOKEN → WHATSAPP_SYSTEM_TOKEN (כמו בשאר הפרויקט)
 */

const PHONE_NUMBER_ID = "1032443923294518";
const FIELDS =
  "id,display_phone_number,verified_name,code_verification_status,quality_rating,status";

const token =
  process.env.WHATSAPP_TOKEN?.trim() ||
  process.env.META_ACCESS_TOKEN?.trim() ||
  process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ||
  "";

if (!token) {
  console.error(
    "חסר טוקן: הגדר WHATSAPP_TOKEN או META_ACCESS_TOKEN (או WHATSAPP_SYSTEM_TOKEN) ב-.env.local"
  );
  process.exit(1);
}

const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}?fields=${encodeURIComponent(FIELDS)}`;

const res = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const raw = await res.text();
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  parsed = raw;
}

console.log("[Meta] HTTP status:", res.status, res.statusText);
console.log("[Meta] URL:", url);
console.log("[Meta] response body:", typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));
