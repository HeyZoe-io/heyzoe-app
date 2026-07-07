/**
 * זמני — שליחת hello_world ל-Meta WhatsApp Cloud API והדפסת התגובה המלאה.
 *
 * הרצה (מהשורש של הפרויקט, עם משתני סביבה מ-.env.local):
 *   node --env-file=.env.local scripts/tmp-meta-whatsapp-hello.mjs
 *   node --env-file=.env.local scripts/tmp-meta-whatsapp-hello.mjs --slug info-2815
 *
 * נמען: תמיד WARMUP_TEST_PHONE. phone_number_id: מ-active channel של --slug / WARMUP_TEST_SLUG.
 * טוקן: WHATSAPP_TOKEN (אם הגדרת), אחרת META_ACCESS_TOKEN או WHATSAPP_SYSTEM_TOKEN
 */

import {
  assertWarmupTestPhone,
  enforceWarmupTestSafe,
  resolveBusinessFromSlug,
  resolveWarmupTestSlug,
} from "./warmup-test-config.mjs";

const TO = enforceWarmupTestSafe("tmp-meta-whatsapp-hello");
const SLUG = resolveWarmupTestSlug();
const { phoneNumberId: PHONE_NUMBER_ID, slug, businessId } = await resolveBusinessFromSlug(SLUG);

const token =
  process.env.WHATSAPP_TOKEN?.trim() ||
  process.env.META_ACCESS_TOKEN?.trim() ||
  process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ||
  "";

if (!token) {
  console.error("חסר טוקן: הגדר WHATSAPP_TOKEN או META_ACCESS_TOKEN או WHATSAPP_SYSTEM_TOKEN ב-.env.local");
  process.exit(1);
}

assertWarmupTestPhone(TO, "tmp-meta-whatsapp-hello before send");

console.log(
  JSON.stringify(
    { slug, businessId, phoneNumberId: PHONE_NUMBER_ID, testPhone: TO },
    null,
    2
  )
);

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
