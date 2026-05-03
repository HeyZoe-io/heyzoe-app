/**
 * זמני — שליחת hello_world ל-Meta WhatsApp Cloud API והדפסת התגובה המלאה.
 *
 * הרצה (מהשורש של הפרויקט, עם משתני סביבה מ-.env.local):
 *   node --env-file=.env.local scripts/tmp-meta-whatsapp-hello.mjs
 *
 * טוקן: WHATSAPP_TOKEN (אם הגדרת), אחרת META_ACCESS_TOKEN או WHATSAPP_SYSTEM_TOKEN
 */

const PHONE_NUMBER_ID = "1032443923294518";
const TO = "972508318162";

const token =
  process.env.WHATSAPP_TOKEN?.trim() ||
  process.env.META_ACCESS_TOKEN?.trim() ||
  process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ||
  "";

if (!token) {
  console.error("חסר טוקן: הגדר WHATSAPP_TOKEN או META_ACCESS_TOKEN או WHATSAPP_SYSTEM_TOKEN ב-.env.local");
  process.exit(1);
}

const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

const body = {
  messaging_product: "whatsapp",
  to: TO,
  type: "template",
  template: {
    name: "hello_world",
    language: { code: "en_US" },
  },
};

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const raw = await res.text();
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  parsed = raw;
}

console.log("[Meta] HTTP status:", res.status, res.statusText);
console.log("[Meta] response body:", typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));
