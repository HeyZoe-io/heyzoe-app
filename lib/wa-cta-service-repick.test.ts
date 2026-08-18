import assert from "node:assert/strict";
import {
  exactTypedCatalogServiceName,
  isPhaseAgnosticExplicitServiceSwitch,
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

console.log("wa-cta-service-repick.test.ts: ok");
