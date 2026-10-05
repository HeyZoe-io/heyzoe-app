import assert from "node:assert/strict";
import {
  formatFreeTextScheduleDateForContact,
  looksLikeNumericCalendarDate,
  rewriteNumericDayPreposition,
} from "@/lib/product-schedule-slots";
import { fillAfterScheduleSelectionTemplate } from "@/lib/sales-flow";
import { sanitizeZoeOutboundLanguage } from "@/lib/zoe-text";

assert.equal(looksLikeNumericCalendarDate("5.10"), true);
assert.equal(looksLikeNumericCalendarDate("05/10/2026"), true);
assert.equal(looksLikeNumericCalendarDate("ראשון"), false);
assert.equal(looksLikeNumericCalendarDate("ראשון 5.10"), false);

assert.equal(rewriteNumericDayPreposition("ביום 5.10 בשעה 19:00"), "בתאריך 5.10 בשעה 19:00");
assert.equal(rewriteNumericDayPreposition("ביום ראשון בשעה 19:00"), "ביום ראשון בשעה 19:00");
assert.equal(
  rewriteNumericDayPreposition("ביום ראשון 5.10 בשעה 19:00"),
  "ביום ראשון 5.10 בשעה 19:00"
);

assert.equal(formatFreeTextScheduleDateForContact("5.10", "יום ראשון"), "ראשון 5.10");
assert.equal(formatFreeTextScheduleDateForContact("5.10", "ראשון"), "ראשון 5.10");
assert.equal(formatFreeTextScheduleDateForContact("5.10", null), "5.10");
assert.equal(formatFreeTextScheduleDateForContact("5.10", ""), "5.10");

assert.equal(
  fillAfterScheduleSelectionTemplate(
    "מהמם! נדאג לשבץ אותך ל{serviceName} ביום {requested_date} בשעה {requested_time}",
    "פילאטיס",
    "5.10",
    "19:00"
  ),
  "מהמם! נדאג לשבץ אותך לפילאטיס בתאריך 5.10 בשעה 19:00"
);

assert.equal(
  fillAfterScheduleSelectionTemplate(
    "מהמם! נדאג לשבץ אותך ל{serviceName} ביום {requested_date} בשעה {requested_time}",
    "פילאטיס",
    "ראשון 5.10",
    "19:00"
  ),
  "מהמם! נדאג לשבץ אותך לפילאטיס ביום ראשון 5.10 בשעה 19:00"
);

assert.equal(
  sanitizeZoeOutboundLanguage("נשמח לראותך ביום 12.10 בשעה 18:00"),
  "נשמח לראותך בתאריך 12.10 בשעה 18:00"
);

assert.equal(
  sanitizeZoeOutboundLanguage("נשמח לראותך ביום שני בשעה 18:00"),
  "נשמח לראותך ביום שני בשעה 18:00"
);

console.log("product-schedule-date-label.test.ts: ok");
