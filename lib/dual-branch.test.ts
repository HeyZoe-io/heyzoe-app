import assert from "node:assert/strict";
import {
  applyDualBranchToKnowledge,
  applyDualBranchToService,
  branchOffersToMeta,
  matchDualBranchChoice,
  parseBranchOffers,
  parseBranchScheduleUrls,
} from "@/lib/dual-branch";
import type { SfServiceRow } from "@/lib/sf-service-rows";

function row(partial: Partial<SfServiceRow> = {}): SfServiceRow {
  return {
    name: "פילאטיס",
    benefit: "",
    priceText: "50",
    durationText: "55",
    descriptionText: "",
    paymentLink: "https://pay.example/default",
    levelsEnabled: false,
    levels: [],
    trialPickMediaUrl: "",
    trialPickMediaType: "",
    offerKind: "trial",
    courseSessionsText: "",
    courseStartDate: "",
    courseEndDate: "",
    scheduleSlots: [{ day: "א", time: "09:00" }],
    courseCycles: [],
    locationMode: "location",
    locationText: "הצפון",
    courseDatesEnabled: true,
    arboxClassName: "",
    ...partial,
  };
}

const amiad = matchDualBranchChoice("עמיעד");
const kiryat = matchDualBranchChoice("קריית שמונה");
assert.equal(amiad, "amiad");
assert.equal(kiryat, "kiryat_shmona");
assert.equal(matchDualBranchChoice("קרית שמונה"), "kiryat_shmona");
assert.equal(matchDualBranchChoice("1"), "amiad");
assert.equal(matchDualBranchChoice("2"), "kiryat_shmona");
assert.equal(matchDualBranchChoice("שלום"), null);

const offers = parseBranchOffers({
  branch_offers: branchOffersToMeta({
    amiad: {
      paymentPage: "https://pay.example/amiad-page",
      paymentLink: "https://pay.example/amiad",
      scheduleSlots: [{ id: "a1", day: "ב", time: "18:00" }],
    },
    kiryat_shmona: {
      paymentPage: "https://pay.example/ks-page",
      paymentLink: "https://pay.example/ks",
      scheduleSlots: [{ id: "k1", day: "ד", time: "20:15" }],
    },
  }),
});

const amiadRow = applyDualBranchToService({ ...row(), branchOffers: offers }, "amiad");
assert.equal(amiadRow.paymentLink, "https://pay.example/amiad");
assert.deepEqual(
  amiadRow.scheduleSlots.map((s) => `${s.day} ${s.time}`),
  ["ב 18:00"]
);
assert.match(amiadRow.locationText, /עמיעד/);

const kiryatRow = applyDualBranchToService({ ...row(), branchOffers: offers }, "kiryat_shmona");
assert.equal(kiryatRow.paymentLink, "https://pay.example/ks");
assert.equal(kiryatRow.scheduleSlots[0]?.time, "20:15");

const pageOnly = applyDualBranchToService(
  {
    ...row(),
    branchOffers: parseBranchOffers({
      branch_offers: {
        amiad: { payment_page: "https://pay.example/page-only", payment_link: "", schedule_slots: [] },
      },
    }),
  },
  "amiad"
);
assert.equal(pageOnly.paymentLink, "https://pay.example/page-only");
assert.equal(pageOnly.scheduleSlots[0]?.time, "09:00");

const urls = parseBranchScheduleUrls({ amiad: " https://sched.example/amiad ", kiryat_shmona: "" });
assert.equal(urls.amiad, "https://sched.example/amiad");
assert.equal(urls.kiryat_shmona, "");

const placed = applyDualBranchToKnowledge(
  {
    arboxLink: "",
    schedulePublicUrl: "",
    addressText: "",
    directionsText: "",
    servicesText: "",
    salesFlowServices: [],
    branchLocations: {
      amiad: { address: "מושב עמיעד", directions: "חניה בכניסה" },
      kiryat_shmona: { address: "שדרות תל חי 12", directions: "קומה 2, דלת ימין" },
    },
  },
  "kiryat_shmona"
);
assert.equal(placed.addressText, "שדרות תל חי 12");
assert.equal(placed.directionsText, "קומה 2, דלת ימין");
assert.match(placed.servicesText, /קריית שמונה/);
assert.doesNotMatch(placed.addressText, /עמיעד/);

console.log("dual-branch: ok");
