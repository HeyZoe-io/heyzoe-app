import assert from "node:assert/strict";
import {
  buildTransactionsReportFailPath,
  CREDIT_REFUSAL_THROTTLE_DAYS,
  isCreditRefusalFailStatus,
  isWithinCreditRefusalThrottle,
} from "@/lib/leads/arbox-credit-refusal";
import { pickCreditRefusalTemplateTriggerRule } from "@/lib/template-triggers-match";

/** FAIL filter: only status FAIL counts as credit refusal. */
{
  assert.equal(isCreditRefusalFailStatus("FAIL"), true);
  assert.equal(isCreditRefusalFailStatus("fail"), true);
  assert.equal(isCreditRefusalFailStatus("SUCCESS"), false);
  assert.equal(isCreditRefusalFailStatus("DECLINED"), false);
  assert.equal(isCreditRefusalFailStatus(null), false);
}

/** transactionsReport path always requests status=FAIL server-side. */
{
  const path = buildTransactionsReportFailPath({
    fromDate: "2026-07-01",
    toDate: "2026-08-01",
    locationId: "3068",
  });
  assert.match(path, /status=FAIL/);
  assert.match(path, /fromDate=2026-07-01/);
  assert.match(path, /location_id=3068/);
  const page2 = buildTransactionsReportFailPath({
    fromDate: "2026-07-01",
    toDate: "2026-08-01",
    locationId: "3068",
    page: 2,
  });
  assert.match(page2, /page=2/);
  assert.match(page2, /fromDate=2026-07-01/);
}

/** Per-customer throttle: 2nd FAIL within window → skipped. */
{
  const now = new Date("2026-08-02T12:00:00.000Z");
  const within = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const outside = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isWithinCreditRefusalThrottle(within, now, 3), true);
  assert.equal(isWithinCreditRefusalThrottle(outside, now, 3), false);
  assert.equal(isWithinCreditRefusalThrottle(null, now, 3), false);
  assert.ok(CREDIT_REFUSAL_THROTTLE_DAYS >= 1);
}

/** Seed-first-run decision: seeded=false → seed path (no alert). */
{
  function decideCreditRefusalRun(seeded: boolean): "seed" | "process" {
    return seeded ? "process" : "seed";
  }
  assert.equal(decideCreditRefusalRun(false), "seed");
  assert.equal(decideCreditRefusalRun(true), "process");
}

/** no_rule: no enabled credit_refusal rule with template → null. */
{
  assert.equal(pickCreditRefusalTemplateTriggerRule([]), null);
  assert.equal(
    pickCreditRefusalTemplateTriggerRule([
      {
        id: "r1",
        business_id: 1,
        trigger_type: "credit_refusal",
        product_filter: null,
        delay_days: 0,
        delay_direction: "after",
        template_name: null,
        enabled: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]),
    null
  );
  const picked = pickCreditRefusalTemplateTriggerRule([
    {
      id: "r-old",
      business_id: 1,
      trigger_type: "credit_refusal",
      product_filter: null,
      delay_days: 0,
      delay_direction: "after",
      template_name: "T_old",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "r-new",
      business_id: 1,
      trigger_type: "credit_refusal",
      product_filter: null,
      delay_days: 1,
      delay_direction: "after",
      template_name: "T_credit_fail",
      enabled: true,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ]);
  assert.equal(picked?.id, "r-new");
  assert.equal(picked?.template_name, "T_credit_fail");
}

console.log("arbox-credit-refusal.test.ts: ok");
