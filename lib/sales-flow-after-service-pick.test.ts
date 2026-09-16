import assert from "node:assert/strict";
import { buildAfterServicePickReplyText } from "@/lib/sales-flow";

const trial = buildAfterServicePickReplyText(
  "",
  {
    name: "קרב מגע לנוער",
    benefit: "מסלול אקדמיה לנוער: קרב מגע והגנה עצמית.",
    priceText: "0",
    durationText: "60",
    offerKind: "trial",
    locationMode: "location",
    locationText: "",
    courseSessionsText: "",
    courseDatesEnabled: true,
    courseCycles: [],
  },
  "רחוב הרצל 1"
);
assert.equal(trial, "מסלול אקדמיה לנוער: קרב מגע והגנה עצמית.");

const online = buildAfterServicePickReplyText(
  "",
  {
    name: "קורס אונליין",
    benefit: "הקורס נמשך 8 מפגשים.",
    priceText: "199",
    durationText: "45",
    offerKind: "course",
    locationMode: "online",
    locationText: "",
    courseSessionsText: "8",
    courseDatesEnabled: true,
    courseCycles: [],
  },
  "כתובת פיזית"
);
assert.equal(online, "הקורס נמשך 8 שיעורים.");

console.log("sales-flow-after-service-pick.test.ts: ok");
