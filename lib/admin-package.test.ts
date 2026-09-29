import assert from "node:assert/strict";
import { resolveAdminPackage } from "@/lib/admin-package";

const now = new Date("2026-10-01T00:00:00.000Z");
const ends = "2026-10-27T07:00:00.000Z";

const intro = resolveAdminPackage({
  plan: "premium",
  planPrice: 429,
  introPeriodEndsAt: ends,
  now,
});
assert.equal(intro.kind, "intro");
assert.equal(intro.billedIls, 5);
assert.equal(intro.conversationLimit, 500);
assert.equal(intro.label, "חודש ראשון");

const fromPriceOnly = resolveAdminPackage({ plan: "basic", planPrice: 5, now });
assert.equal(fromPriceOnly.kind, "intro");
assert.equal(fromPriceOnly.billedIls, 5);
assert.equal(fromPriceOnly.conversationLimit, 500);

const waiting = resolveAdminPackage({
  plan: "premium",
  planPrice: 429,
  introPeriodEndsAt: ends,
  now: new Date("2026-10-28T00:00:00.000Z"),
});
assert.equal(waiting.kind, "intro_ended");
assert.equal(waiting.billedIls, 5);

const pro = resolveAdminPackage({
  plan: "premium",
  planPrice: 429,
  introPeriodEndsAt: ends,
  introFullPriceAt: "2026-10-24T00:00:00.000Z",
  now,
});
assert.equal(pro.kind, "pro");
assert.equal(pro.billedIls, 429);
assert.equal(pro.conversationLimit, 500);

const starter = resolveAdminPackage({ plan: "basic", planPrice: null, now });
assert.equal(starter.kind, "starter");
assert.equal(starter.billedIls, 299);
assert.equal(starter.conversationLimit, 100);

const custom = resolveAdminPackage({ plan: "premium", planPrice: 350, now });
assert.equal(custom.label, "Pro");
assert.equal(custom.billedIls, 350);

console.log("admin-package.test.ts ok");
