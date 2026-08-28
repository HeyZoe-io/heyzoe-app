import assert from "node:assert/strict";
import {
  assertHeyzoeSafeTestRecipient,
  assertWhatsAppOutboundAllowed,
  decideWhatsAppOutbound,
  HEYZOE_MARKETING_LINE_DIGITS,
  HEYZOE_MARKETING_PHONE_NUMBER_ID,
  HEYZOE_SAFE_TEST_PHONE,
  isHeyzoeSafeTestPhone,
  whatsappPeerDigits,
} from "@/lib/wa-send-guard";

assert.equal(whatsappPeerDigits("0508318162"), HEYZOE_SAFE_TEST_PHONE);
assert.equal(isHeyzoeSafeTestPhone("0508318162"), true);
assert.equal(isHeyzoeSafeTestPhone("0559902641"), false);
assert.equal(assertHeyzoeSafeTestRecipient("050-831-8162", "test"), HEYZOE_SAFE_TEST_PHONE);
assert.throws(() => assertHeyzoeSafeTestRecipient("0559902641", "test"));

assert.equal(
  decideWhatsAppOutbound({
    fromPhoneNumberId: "studio-pnid",
    to: HEYZOE_MARKETING_LINE_DIGITS,
  }).ok,
  false
);
assert.equal(
  decideWhatsAppOutbound({
    fromPhoneNumberId: HEYZOE_MARKETING_PHONE_NUMBER_ID,
    to: HEYZOE_MARKETING_LINE_DIGITS,
  }).ok,
  true
);
assert.equal(
  decideWhatsAppOutbound({
    fromPhoneNumberId: HEYZOE_MARKETING_PHONE_NUMBER_ID,
    to: "0559902641",
  }).ok,
  true
);

for (let i = 0; i < 40; i++) {
  assert.equal(
    decideWhatsAppOutbound({ fromPhoneNumberId: "pnid-a", to: "0559902641" }).ok,
    true,
    "no per-second cap on customer sends"
  );
}

assert.doesNotThrow(() =>
  assertWhatsAppOutboundAllowed({ fromPhoneNumberId: "pnid", to: "0508318162" })
);
assert.throws(() =>
  assertWhatsAppOutboundAllowed({
    fromPhoneNumberId: "studio",
    to: HEYZOE_MARKETING_LINE_DIGITS,
  })
);

console.log("wa-send-guard.test.ts: ok");
