import assert from "node:assert/strict";
import {
  isNonProdSendBlocked,
  NON_PROD_SEND_BLOCKED,
  NON_PROD_SEND_PHONE,
  nonProductionSendAllowed,
  postWhatsAppGraphMessage,
} from "./graph-whatsapp-send";

const previous = process.env.VERCEL_ENV;

function restoreEnv() {
  if (previous === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previous;
}

async function main() {
  delete process.env.VERCEL_ENV;
  assert.equal(nonProductionSendAllowed("972501111111"), false);
  assert.equal(nonProductionSendAllowed("+972508318162"), true);
  process.env.VERCEL_ENV = "preview";
  assert.equal(nonProductionSendAllowed(NON_PROD_SEND_PHONE), true);
  assert.equal(nonProductionSendAllowed("972544300803"), false);
  process.env.VERCEL_ENV = "production";
  assert.equal(nonProductionSendAllowed("972544300803"), true);
  restoreEnv();

  delete process.env.VERCEL_ENV;
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        postWhatsAppGraphMessage({
          phoneNumberId: "1",
          to: "972544300803",
          token: "t",
          body: { messaging_product: "whatsapp" },
        }),
      (error: unknown) => isNonProdSendBlocked(error) && (error as Error).message === NON_PROD_SEND_BLOCKED
    );
    assert.equal(fetches, 0);

    const ok = await postWhatsAppGraphMessage({
      phoneNumberId: "1",
      to: "972508318162",
      token: "t",
      body: { messaging_product: "whatsapp" },
    });
    assert.equal(ok.ok, true);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = original;
    restoreEnv();
  }

  console.log("graph-whatsapp-send.test.ts ok");
}

main();
