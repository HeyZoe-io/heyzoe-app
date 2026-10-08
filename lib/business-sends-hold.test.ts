/**
 * Dry-run hold: every customer outbound path logs a would-send and does not call Meta/Twilio.
 * Run: npx tsx lib/business-sends-hold.test.ts
 */
import assert from "node:assert/strict";
import {
  isDryRunSendsHold,
  isSendsHoldError,
  maskSendPhone,
  peekWouldSends,
  SendsHoldError,
  sendsHoldModeFromSocialLinks,
  setSendsHoldLookupForTests,
  takeWouldSends,
  templateFailureDispatch,
} from "./business-sends-hold";
import { decideScheduledSendAfterMeta } from "./scheduled-template-sends";
import { sendBusinessTemplate } from "./notifications/sendOwnerNotification";
import {
  sendMetaWhatsAppMessage,
  sendWhatsAppIdleFollowupMessage,
  sendWhatsAppMediaMessage,
  sendWhatsAppMessage,
  sendWhatsAppTextOrMenu,
} from "./whatsapp";
import { sendMetaWhatsAppText } from "../app/api/contacts/send/route";

process.env.META_ACCESS_TOKEN = "test-token";
process.env.META_WHATSAPP_ACCESS_TOKEN = "test-token";

const PHONE_ID = "123456789012345";
const TO = "972501234567";

let fetches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetches += 1;
  throw new Error("network_should_not_run");
}) as typeof fetch;

function reset() {
  fetches = 0;
  takeWouldSends();
}

async function expectHeld(label: string, run: () => Promise<unknown>) {
  reset();
  let threw = false;
  try {
    await run();
  } catch (e) {
    threw = true;
    assert.equal(isSendsHoldError(e), true, label);
  }
  assert.equal(fetches, 0, `${label} must not call fetch`);
  const logged = peekWouldSends();
  assert.equal(logged.length, 1, `${label} logs one would-send, got ${logged.length}`);
  assert.equal(logged[0]?.to_masked, maskSendPhone(TO));
  assert.equal(threw || logged.length === 1, true);
  return { threw, kind: logged[0]?.kind };
}

{
  assert.equal(sendsHoldModeFromSocialLinks(null), null);
  assert.equal(sendsHoldModeFromSocialLinks({ sales_flow: {} }), null);
  assert.equal(sendsHoldModeFromSocialLinks({ sales_flow: { sends_hold: "dry_run" } }), "dry_run");
  assert.equal(isDryRunSendsHold({ sales_flow: { sends_hold: "dry_run" } }), true);
  assert.equal(isDryRunSendsHold({ sales_flow: { sends_hold: "off" } }), false);
  assert.equal(templateFailureDispatch("sends_hold"), "gated");
  assert.equal(templateFailureDispatch("http_500"), "send_failed");
  assert.equal(templateFailureDispatch(new SendsHoldError()), "gated");
  const held = decideScheduledSendAfterMeta({ ok: false, error: "sends_hold" });
  assert.equal(held.status, "held");
}

async function main() {
setSendsHoldLookupForTests(async () => true);

const template = await expectHeld("template", () =>
  sendBusinessTemplate({
    to: TO,
    phoneNumberId: PHONE_ID,
    templateName: "trial_booked",
    skipOptOutGate: true,
  })
);
assert.equal(template.threw, false);
assert.equal(template.kind, "template");
reset();
const templateResult = await sendBusinessTemplate({
  to: TO,
  phoneNumberId: PHONE_ID,
  templateName: "trial_booked",
  skipOptOutGate: true,
});
assert.equal(templateResult.ok, false);
assert.equal(templateResult.error, "sends_hold");
assert.equal(fetches, 0);

await expectHeld("meta text", () =>
  sendMetaWhatsAppMessage(PHONE_ID, TO, { type: "text", text: "שלום" })
);
await expectHeld("whatsapp text", () =>
  sendWhatsAppMessage(PHONE_ID, TO, "שלום", "sid", "token")
);
await expectHeld("twilio text", () =>
  sendWhatsAppMessage("+14155550100", TO, "שלום", "sid", "token")
);
await expectHeld("media", () =>
  sendWhatsAppMediaMessage(PHONE_ID, TO, "https://example.com/a.jpg", "sid", "token", "לוח", "image")
);
await expectHeld("audio", () =>
  sendWhatsAppMediaMessage(PHONE_ID, TO, "https://example.com/a.mp3", "sid", "token", undefined, "audio")
);
await expectHeld("menu", () =>
  sendWhatsAppTextOrMenu(PHONE_ID, TO, "מה תרצי", ["בוקר", "ערב"], "sid", "token")
);
await expectHeld("followup", () =>
  sendWhatsAppIdleFollowupMessage(
    PHONE_ID,
    TO,
    "עוד כאן?",
    "",
    { mode: "reply", label: "כן" },
    "sid",
    "token"
  )
);
await expectHeld("dashboard", () =>
  sendMetaWhatsAppText({
    phoneNumberId: PHONE_ID,
    to: TO,
    body: "הודעה מהדשבורד",
    accessToken: "test-token",
  })
);

setSendsHoldLookupForTests(async () => false);
reset();
globalThis.fetch = (async () =>
  new Response("{}", { status: 200 })) as typeof fetch;
// fetch is stubbed above; the non-production recipient lock is not under test here.
const originalVercelEnv = process.env.VERCEL_ENV;
process.env.VERCEL_ENV = "production";
let open: Awaited<ReturnType<typeof sendBusinessTemplate>>;
try {
  open = await sendBusinessTemplate({
    to: TO,
    phoneNumberId: PHONE_ID,
    templateName: "trial_booked",
    skipOptOutGate: true,
  });
} finally {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
}
assert.equal(open.ok, true);
assert.equal(peekWouldSends().length, 0);

globalThis.fetch = originalFetch;
setSendsHoldLookupForTests(null);
console.log("business-sends-hold.test.ts ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
