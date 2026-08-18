import assert from "node:assert/strict";
import {
  exactTypedCatalogServiceName,
  isPhaseAgnosticExplicitServiceSwitch,
  isAmbiguousPartialCatalogServiceSwitch,
  findAmbiguousPartialCatalogMatches,
} from "@/lib/wa-cta-service-repick";

const names = ["אקרו יוגה - סדנת היכרות", "אקרו יוגה - לזוג", "אקרו יוגה"];

assert.equal(exactTypedCatalogServiceName("אקרו יוגה - לזוג", names), "אקרו יוגה - לזוג");
assert.equal(exactTypedCatalogServiceName("  אקרו יוגה - לזוג  ", names), "אקרו יוגה - לזוג");
assert.equal(exactTypedCatalogServiceName("אקרו יוגה  -  לזוג", names), "אקרו יוגה - לזוג");

assert.equal(exactTypedCatalogServiceName("אקרו יוגה - לזוג בבקשה", names), null);
assert.equal(exactTypedCatalogServiceName("רוצה לעבור לאקרו יוגה - לזוג", names), null);
assert.equal(exactTypedCatalogServiceName("לזוג", names), null);
assert.equal(exactTypedCatalogServiceName("", names), null);

assert.equal(
  isPhaseAgnosticExplicitServiceSwitch("אקרו יוגה - לזוג", "אקרו יוגה - סדנת היכרות", names),
  false
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch(
    "רוצה לעבור לאקרו יוגה - לזוג",
    "אקרו יוגה - סדנת היכרות",
    names
  ),
  true
);

const limitless = [
  "אימוני כוח - Strength",
  "POWER&HIIT",
  "Mobility power",
  "מוביליטי וגמישות",
  "פילאטיס מכשירים",
  "פילאטיס מזרן",
  "אימון אישי",
  "עיסוי רפואי",
];

assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אני רוצה לנסות פילאטיס", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("יש פילאטיס?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("יש לכם פילאטיס", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("האם יש פילאטיס?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("פילאטיס?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אפשר פילאטיס?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אפשר לי פילאטיס", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אפשר לשלם בביט?", "אימון אישי", limitless),
  false
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch("אני רוצה לנסות פילאטיס", "אימון אישי", limitless),
  false
);
assert.deepEqual(findAmbiguousPartialCatalogMatches("פילאטיס", ["פילאטיס מכשירים"]), []);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("מה זה פילאטיס", "אימון אישי", limitless),
  false
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch("רוצה לעבור לפילאטיס מכשירים", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("רוצה לעבור לפילאטיס מכשירים", "אימון אישי", limitless),
  false
);

console.log("wa-cta-service-repick.test.ts: ok");
