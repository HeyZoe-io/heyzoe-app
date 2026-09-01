import assert from "node:assert/strict";
import {
  PRICE_WHICH_SERVICE_REPLY,
  matchesUnspecifiedClassPriceQuestion,
  shouldOfferServicePickForUnspecifiedPrice,
} from "@/lib/wa-price-which-service";
import {
  matchCatalogServiceFromFreeText,
  matchCatalogServicesFromFreeText,
} from "@/lib/wa-unknown-class-slot";

const joeCatalog = [
  { name: "אקרו יוגה - ליחיד" },
  { name: "אקרו יוגה - לזוג" },
  { name: "עמידות ידיים / גמישות" },
  { name: "שיעור אקרו אישי (1 - 1)" },
  { name: "קורס אקרויוגה אונליין" },
  { name: "סדנאות ואירועים מיוחדים" },
];

assert.equal(PRICE_WHICH_SERVICE_REPLY, "איזה אימון מעניין אותך? אגיד לך את המחיר שלו");

assert.equal(matchesUnspecifiedClassPriceQuestion("כמה עולה שיעור ניסיון?"), true);
assert.equal(matchesUnspecifiedClassPriceQuestion("היי כמה עולה שיעור ניסיון?"), true);
assert.equal(matchesUnspecifiedClassPriceQuestion("כמה עולה אימון היכרות"), true);
assert.equal(matchesUnspecifiedClassPriceQuestion("כמה עולה השיעור?"), true);
assert.equal(matchesUnspecifiedClassPriceQuestion("כמה עולה?"), true);
assert.equal(matchesUnspecifiedClassPriceQuestion("מה המחיר?"), true);
assert.equal(matchesUnspecifiedClassPriceQuestion("כמה עולה מנוי?"), false);
assert.equal(matchesUnspecifiedClassPriceQuestion("רוצה שיעור ניסיון"), false);
assert.equal(matchesUnspecifiedClassPriceQuestion("איזה אימון מתאים למתחילים?"), false);

assert.equal(
  matchCatalogServiceFromFreeText("כמה עולה שיעור ניסיון?", joeCatalog),
  null,
  "generic שיעור must not pick private lesson"
);
assert.deepEqual(matchCatalogServicesFromFreeText("כמה עולה שיעור ניסיון?", joeCatalog), []);

assert.equal(
  shouldOfferServicePickForUnspecifiedPrice({
    inbound: "כמה עולה שיעור ניסיון?",
    serviceCount: joeCatalog.length,
    uniqueCatalogMatches: matchCatalogServicesFromFreeText("כמה עולה שיעור ניסיון?", joeCatalog)
      .length,
    canOfferPick: true,
  }),
  true
);

assert.equal(
  shouldOfferServicePickForUnspecifiedPrice({
    inbound: "כמה עולה שיעור ניסיון?",
    serviceCount: joeCatalog.length,
    uniqueCatalogMatches: 0,
    canOfferPick: false,
  }),
  false,
  "already past product pick"
);

assert.equal(
  matchCatalogServiceFromFreeText("כמה עולה עמידות ידיים?", joeCatalog),
  "עמידות ידיים / גמישות"
);
assert.equal(
  shouldOfferServicePickForUnspecifiedPrice({
    inbound: "כמה עולה עמידות ידיים?",
    serviceCount: joeCatalog.length,
    uniqueCatalogMatches: 1,
    canOfferPick: true,
  }),
  false,
  "named product → quote that price / pick it"
);

assert.equal(
  shouldOfferServicePickForUnspecifiedPrice({
    inbound: "כמה עולה שיעור ניסיון?",
    serviceCount: 1,
    uniqueCatalogMatches: 0,
    canOfferPick: true,
  }),
  false,
  "single product — answer the price"
);

console.log("wa-price-which-service.test.ts: ok");
