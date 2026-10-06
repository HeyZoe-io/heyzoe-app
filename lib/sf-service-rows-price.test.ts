import assert from "node:assert/strict";
import { parseSfServiceRows } from "@/lib/sf-service-rows";

const fromMeta = parseSfServiceRows([
  {
    name: "פילאטיס",
    price_text: "",
    description: JSON.stringify({
      price_text: "80",
      duration: "55",
      benefit_line: "שיעור ניסיון",
      offer_kind: "trial",
      branch_offers: {
        amiad: { payment_page: "https://pay.example/amiad", payment_link: "", schedule_slots: [] },
        kiryat_shmona: { payment_page: "https://pay.example/ks", payment_link: "", schedule_slots: [] },
      },
    }),
  },
]);
assert.equal(fromMeta[0]?.priceText, "80");
assert.equal(fromMeta[0]?.durationText, "55");
assert.equal(fromMeta[0]?.branchOffers?.amiad.paymentPage, "https://pay.example/amiad");

const columnWins = parseSfServiceRows([
  {
    name: "יוגה",
    price_text: "90",
    description: JSON.stringify({ price_text: "80", duration: "45", offer_kind: "trial" }),
  },
]);
assert.equal(columnWins[0]?.priceText, "90");

console.log("sf-service-rows-price: ok");
