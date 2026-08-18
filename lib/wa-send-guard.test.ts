import assert from "node:assert/strict";
import {
  assertHeyzoeSafeTestRecipient,
  assertWhatsAppOutboundAllowed,
  decideWhatsAppOutbound,
  HEYZOE_MARKETING_LINE_DIGITS,
  HEYZOE_MARKETING_PHONE_NUMBER_ID,
  HEYZOE_SAFE_TEST_PHONE,
  isHeyzoeSafeTestPhone,
  resetWaSendGuardForTests,
  WA_OUTBOUND_MAX_PER_PAIR,
  WA_OUTBOUND_MAX_PER_RECIPIENT,
  whatsappPeerDigits,
} from "@/lib/wa-send-guard";

assert.equal(whatsappPeerDigits("0508318162"), HEYZOE_SAFE_TEST_PHONE);
assert.equal(isHeyzoeSafeTestPhone("0508318162"), true);
assert.equal(isHeyzoeSafeTestPhone("0559902641"), false);
assert.equal(assertHeyzoeSafeTestRecipient("050-831-8162", "test"), HEYZOE_SAFE_TEST_PHONE);
assert.throws(() => assertHeyzoeSafeTestRecipient("0559902641", "test"));

resetWaSendGuardForTests();
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

resetWaSendGuardForTests();
for (let i = 0; i < WA_OUTBOUND_MAX_PER_PAIR; i++) {
  assert.equal(
    decideWhatsAppOutbound({ fromPhoneNumberId: "pnid-a", to: "0559902641", nowMs: 1_000 + i }).ok,
    true
  );
}
const flooded = decideWhatsAppOutbound({
  fromPhoneNumberId: "pnid-a",
  to: "0559902641",
  nowMs: 1_000 + WA_OUTBOUND_MAX_PER_PAIR,
});
assert.equal(flooded.ok, false);
if (!flooded.ok) assert.equal(flooded.reason, "flood_pair");

resetWaSendGuardForTests();
for (let i = 0; i < WA_OUTBOUND_MAX_PER_RECIPIENT; i++) {
  assert.equal(
    decideWhatsAppOutbound({
      fromPhoneNumberId: `pnid-${i}`,
      to: "0508318162",
      nowMs: 2_000 + i,
    }).ok,
    true
  );
}
const recipFlood = decideWhatsAppOutbound({
  fromPhoneNumberId: "pnid-last",
  to: "0508318162",
  nowMs: 2_000 + WA_OUTBOUND_MAX_PER_RECIPIENT,
});
assert.equal(recipFlood.ok, false);
if (!recipFlood.ok) assert.equal(recipFlood.reason, "flood_recipient");

resetWaSendGuardForTests();
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
