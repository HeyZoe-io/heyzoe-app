import assert from "node:assert/strict";
import {
  addressForSelectedBranch,
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
assert.equal(amiadRow.paymentLink, "https://pay.example/amiad-page");
assert.equal(amiadRow.priceText, "50");
assert.deepEqual(
  amiadRow.scheduleSlots.map((s) => `${s.day} ${s.time}`),
  ["ב 18:00"]
);
assert.match(amiadRow.locationText, /עמיעד/);

const kiryatRow = applyDualBranchToService({ ...row(), branchOffers: offers }, "kiryat_shmona");
assert.equal(kiryatRow.paymentLink, "https://pay.example/ks-page");
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

const legacyLink = applyDualBranchToService(
  {
    ...row(),
    branchOffers: parseBranchOffers({
      branch_offers: {
        amiad: { payment_page: "", payment_link: "https://pay.example/legacy", schedule_slots: [] },
      },
    }),
  },
  "amiad"
);
assert.equal(legacyLink.paymentLink, "https://pay.example/legacy");

const locations = {
  amiad: { address: "מושב עמיעד", directions: "חניה בכניסה" },
  kiryat_shmona: { address: "שדרות תל חי 12", directions: "קומה 2" },
};
assert.equal(addressForSelectedBranch(locations, "kiryat_shmona"), "שדרות תל חי 12");
assert.equal(addressForSelectedBranch(locations, "amiad"), "מושב עמיעד");
assert.equal(addressForSelectedBranch(locations, null), "");
assert.equal(pageOnly.scheduleSlots[0]?.time, "09:00");

const urls = parseBranchScheduleUrls({ amiad: " https://sched.example/amiad ", kiryat_shmona: "" });
assert.equal(urls.amiad, "https://sched.example/amiad");
assert.equal(urls.kiryat_shmona, "");

const placed = applyDualBranchToKnowledge(
  {
    arboxLink: "",
    schedulePublicUrl: "",
    scheduleScanImageUrl: "https://img.example/shared.png",
    addressText: "",
    directionsText: "",
    servicesText: "",
    salesFlowServices: [],
    branchScheduleUrls: {
      amiad: "https://sched.example/amiad",
      kiryat_shmona: "https://sched.example/ks",
    },
    branchScheduleImageUrls: {
      amiad: "https://img.example/amiad.png",
      kiryat_shmona: "https://img.example/ks.png",
    },
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
assert.equal(placed.schedulePublicUrl, "https://sched.example/ks");
assert.equal(placed.scheduleScanImageUrl, "https://img.example/ks.png");
assert.equal((placed as { activeDualBranch?: string }).activeDualBranch, "kiryat_shmona");

const amiadPlaced = applyDualBranchToKnowledge(
  {
    arboxLink: "",
    schedulePublicUrl: "",
    scheduleScanImageUrl: "",
    addressText: "",
    directionsText: "",
    servicesText: "",
    salesFlowServices: [],
    branchScheduleImageUrls: {
      amiad: "https://img.example/amiad.png",
      kiryat_shmona: "https://img.example/ks.png",
    },
  },
  "amiad"
);
assert.equal(amiadPlaced.scheduleScanImageUrl, "https://img.example/amiad.png");
assert.equal((amiadPlaced as { activeDualBranch?: string }).activeDualBranch, "amiad");

console.log("dual-branch: ok");
