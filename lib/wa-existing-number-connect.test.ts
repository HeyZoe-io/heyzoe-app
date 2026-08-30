import assert from "node:assert/strict";
import {
  pickWabaPhone,
  shouldUseExistingNumberConnect,
} from "@/lib/wa-existing-number-connect";

assert.equal(
  shouldUseExistingNumberConnect({ storedOnboardingType: "coexistence" }),
  true
);
assert.equal(
  shouldUseExistingNumberConnect({ requestedOnboardingType: "coexistence" }),
  true
);
assert.equal(
  shouldUseExistingNumberConnect({ phoneNumberIdFromClient: "1337733742749731" }),
  true
);
assert.equal(shouldUseExistingNumberConnect({ metaPhoneCount: 1 }), true);

// Explicit new-number path with an empty WABA stays on provisioning.
assert.equal(
  shouldUseExistingNumberConnect({
    storedOnboardingType: "new_provisioned",
    metaPhoneCount: 0,
  }),
  false
);

// Skipped path choice + existing number from Meta (Yigal's case).
assert.equal(
  shouldUseExistingNumberConnect({
    storedOnboardingType: null,
    phoneNumberIdFromClient: "1337733742749731",
    metaPhoneCount: 1,
  }),
  true
);

// Dashboard later-connect should win over a leftover new_provisioned flag.
assert.equal(
  shouldUseExistingNumberConnect({
    storedOnboardingType: "new_provisioned",
    requestedOnboardingType: "coexistence",
  }),
  true
);

// Explicit new-number path is left to wa-provision, even if Meta already lists a line.
assert.equal(
  shouldUseExistingNumberConnect({
    storedOnboardingType: "new_provisioned",
    metaPhoneCount: 1,
  }),
  false
);

assert.equal(shouldUseExistingNumberConnect({}), false);
assert.equal(shouldUseExistingNumberConnect({ storedOnboardingType: "" }), false);
assert.equal(shouldUseExistingNumberConnect({ phoneNumberIdFromClient: "  " }), false);

const yigalNumbers = [
  {
    id: "1337733742749731",
    display_phone_number: "+972 54-692-5927",
    status: "CONNECTED",
  },
];

assert.deepEqual(pickWabaPhone(yigalNumbers, "1337733742749731"), {
  phoneNumberId: "1337733742749731",
  phoneDisplay: "+972 54-692-5927",
});

assert.deepEqual(pickWabaPhone(yigalNumbers, "missing-id"), {
  phoneNumberId: "missing-id",
  phoneDisplay: "+972 54-692-5927",
});

assert.deepEqual(pickWabaPhone(yigalNumbers), {
  phoneNumberId: "1337733742749731",
  phoneDisplay: "+972 54-692-5927",
});

assert.equal(pickWabaPhone([]), null);
assert.deepEqual(pickWabaPhone([], "1337733742749731"), {
  phoneNumberId: "1337733742749731",
  phoneDisplay: null,
});

assert.deepEqual(
  pickWabaPhone(
    [
      { id: "pending", status: "PENDING", display_phone_number: "+972 3 000 0000" },
      { id: "live", status: "CONNECTED", display_phone_number: "+972 54-692-5927" },
    ]
  ),
  { phoneNumberId: "live", phoneDisplay: "+972 54-692-5927" }
);

console.log("wa-existing-number-connect tests passed");
