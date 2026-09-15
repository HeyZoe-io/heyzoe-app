import assert from "node:assert/strict";
import {
  formatAgorot,
  META_RATES_IL,
  metaMonthlyExampleIls,
  metaMonthlyExampleMessages,
  usdRateToAgorot,
  usdRateToIls,
} from "@/lib/meta-pricing-notice";

assert.equal(formatAgorot(usdRateToAgorot(META_RATES_IL.service)), "1.6", "service rate agorot");
assert.equal(formatAgorot(usdRateToAgorot(META_RATES_IL.utility)), "1.6", "utility rate agorot");
assert.equal(formatAgorot(usdRateToAgorot(META_RATES_IL.marketing)), "10.7", "marketing rate agorot");
assert.equal(usdRateToIls(META_RATES_IL.service), "0.016", "service rate ILS");
assert.equal(usdRateToIls(META_RATES_IL.utility), "0.016", "utility rate ILS");
assert.equal(usdRateToIls(META_RATES_IL.marketing), "0.107", "marketing rate ILS");
assert.equal(metaMonthlyExampleMessages(), 1600, "200 conversations x 8 messages");
assert.equal(metaMonthlyExampleIls(), 26, "monthly example rounds to 26 ILS");

console.log("meta-pricing-notice: ok");
