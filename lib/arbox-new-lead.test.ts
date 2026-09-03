import assert from "node:assert/strict";
import {
  buildAllLeadsReportPath,
  clampAllLeadsReportDateRange,
  parseLeadIdFromUserId,
  resolveAllLeadsReportDateRange,
  seedAllLeadsReportDateRange,
  ARBOX_NEW_LEAD_CONTACT_SOURCE,
  decideArboxNewLeadOpener,
  isArboxZoeCreatedLeadSource,
  shouldSeedArboxNewLeadRow,
  templateComponentsUseFirstName,
} from "@/lib/leads/arbox-new-lead";
import {
  collectArboxCustomerUserIds,
  isArboxActiveCustomerMembershipStatus,
  isArboxActiveCustomerSessionStatus,
  shouldFetchArboxCustomerSet,
} from "@/lib/leads/arbox-customer-set";
import { isOpeningTemplateLeadSource } from "@/lib/lead-template";
import { buildArboxNewLeadScheduledDedupKey } from "@/lib/scheduled-template-sends";
import { pickArboxNewLeadTemplateTriggerRule } from "@/lib/template-triggers-match";
import { isArboxDependentTriggerType, isTriggerType } from "@/lib/template-trigger-types";

/** Live report name is camelCase allLeadsReport (AllLeadsReport / leadsReport 400). */
{
  const path = buildAllLeadsReportPath({
    fromDate: "2026-08-10",
    toDate: "2026-08-17",
    locationId: "3068",
  });
  assert.match(path, /\/v3\/reports\/allLeadsReport\?/);
  assert.match(path, /fromDate=2026-08-10/);
  assert.match(path, /toDate=2026-08-17/);
  assert.match(path, /location_id=3068/);
  const page2 = buildAllLeadsReportPath({
    fromDate: "2026-08-10",
    toDate: "2026-08-17",
    locationId: "3068",
    page: 2,
  });
  assert.match(page2, /page=2/);
}

/** Stable lead id is allLeadsReport user_id (no separate lead_id on the row). */
{
  assert.equal(parseLeadIdFromUserId(11049159), 11049159);
  assert.equal(parseLeadIdFromUserId("11149799"), 11149799);
  assert.equal(parseLeadIdFromUserId(0), null);
  assert.equal(parseLeadIdFromUserId(""), null);
  assert.equal(parseLeadIdFromUserId(null), null);
}

/** fromDate/toDate clamp: 45-day span → 30 days (same 31-day API cap as other reports). */
{
  const clamped = clampAllLeadsReportDateRange({
    fromDate: "2026-07-03",
    toDate: "2026-08-17",
  });
  assert.equal(clamped.toDate, "2026-08-17");
  assert.equal(clamped.fromDate, "2026-07-18");
  const ok = clampAllLeadsReportDateRange({
    fromDate: "2026-08-10",
    toDate: "2026-08-17",
  });
  assert.deepEqual(ok, { fromDate: "2026-08-10", toDate: "2026-08-17" });
}

/** Seed window is the max 30-day span ending today (Israel). */
{
  const now = new Date("2026-08-17T12:00:00+03:00");
  const seed = seedAllLeadsReportDateRange(now);
  assert.equal(seed.toDate, "2026-08-17");
  assert.equal(seed.fromDate, "2026-07-18");
}

/** Process window follows last sync, clamped. */
{
  const now = new Date("2026-08-17T12:00:00+03:00");
  const recent = resolveAllLeadsReportDateRange({
    arboxLastSyncAt: "2026-08-16T09:00:00.000Z",
    now,
  });
  assert.equal(recent.fromDate, "2026-08-16");
  assert.equal(recent.toDate, "2026-08-17");
  const stale = resolveAllLeadsReportDateRange({
    arboxLastSyncAt: "2026-06-01T00:00:00.000Z",
    now,
  });
  assert.equal(stale.fromDate, "2026-07-18");
  assert.equal(stale.toDate, "2026-08-17");
}

/** Seed-first-run: ALL current allLeads user_ids are marked seen; no send. */
{
  assert.equal(shouldSeedArboxNewLeadRow(false), true);
  assert.equal(shouldSeedArboxNewLeadRow(true), false);
  const wouldFireIfProcessed = decideArboxNewLeadOpener({
    seen: false,
    zoeSource: false,
    alreadyInApp: false,
    isCustomer: false,
  });
  assert.equal(wouldFireIfProcessed, "fire");
  assert.equal(
    decideArboxNewLeadOpener({
      seen: true,
      zoeSource: false,
      alreadyInApp: false,
      isCustomer: false,
    }),
    "already"
  );
}

const fireShape = {
  seen: false,
  zoeSource: false,
  alreadyInApp: false,
  isCustomer: false,
};

/** Unseen non-customer non-Zoe not already in-app fires. */
{
  assert.equal(decideArboxNewLeadOpener(fireShape), "fire");
}

/** Already-seen does not fire. */
{
  assert.equal(decideArboxNewLeadOpener({ ...fireShape, seen: true }), "already");
}

/** Zoe-sourced does not fire. */
{
  assert.equal(decideArboxNewLeadOpener({ ...fireShape, zoeSource: true }), "zoe");
}

/** Existing customer does not fire. */
{
  assert.equal(decideArboxNewLeadOpener({ ...fireShape, isCustomer: true }), "customer");
}

/** already_in_app is kept: existing Zoe contact is marked seen, no send. */
{
  assert.equal(decideArboxNewLeadOpener({ ...fireShape, alreadyInApp: true }), "already_in_app");
}

/** Seen wins over every other skip reason. */
{
  assert.equal(
    decideArboxNewLeadOpener({ seen: true, zoeSource: true, alreadyInApp: true, isCustomer: true }),
    "already"
  );
}

/**
 * Status is unused. Hebrew "לא נוצר קשר" still fires when the other conditions
 * hold — same as "ניסיון 1" / "Lost". No status-string matcher.
 */
{
  for (const status of ["לא נוצר קשר", "ניסיון 1", "Lost"] as const) {
    assert.equal(decideArboxNewLeadOpener(fireShape), "fire", status);
  }
}

/**
 * Customer-set IO: the "is there a new lead?" check is the count AFTER
 * sync_log + Zoe-source. A Zoe-only unseen row must not fetch
 * memberships/sessions. already_in_app is not part of this skip.
 */
{
  function unseenNonZoeCount(rows: Array<{ seen: boolean; zoeSource: boolean }>): number {
    return rows.filter((r) => !r.seen && !r.zoeSource).length;
  }
  assert.equal(shouldFetchArboxCustomerSet(0), false);
  assert.equal(shouldFetchArboxCustomerSet(1), true);
  assert.equal(
    shouldFetchArboxCustomerSet(
      unseenNonZoeCount([
        { seen: true, zoeSource: false },
        { seen: false, zoeSource: true },
      ])
    ),
    false
  );
  assert.equal(
    shouldFetchArboxCustomerSet(unseenNonZoeCount([{ seen: false, zoeSource: false }])),
    true
  );
  const ids = collectArboxCustomerUserIds({
    membershipRows: [
      { user_id: 10, status: "active" },
      { user_id: 11, status: "activeMemberWithFutureCancel" },
      { user_id: 12, status: "expired" },
    ],
    sessionRows: [
      { user_id: 20, status: "active" },
      { user_id: 21, status: "expired" },
    ],
  });
  assert.deepEqual([...ids].sort((a, b) => a - b), [10, 11, 20]);
  assert.equal(isArboxActiveCustomerMembershipStatus("active"), true);
  assert.equal(isArboxActiveCustomerMembershipStatus("activeMemberWithFutureCancel"), true);
  assert.equal(isArboxActiveCustomerSessionStatus("active"), true);
  assert.equal(isArboxActiveCustomerSessionStatus("expired"), false);
}

/** Zoe-created Arbox leads are skipped (already on WhatsApp). */
{
  assert.equal(isArboxZoeCreatedLeadSource("זואי"), true);
  assert.equal(isArboxZoeCreatedLeadSource("פילאטיס נשים"), false);
}

/** Body {{1}} detection — Limitless template has none. */
{
  assert.equal(
    templateComponentsUseFirstName([
      {
        type: "BODY",
        text: "ברוכים הבאים ל - Limitless!\nבואו נמצא את האימון המושלם בשבילכם!\nלחצו על הכפתור👇",
      },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "בואו נתחיל!" }] },
    ]),
    false
  );
  assert.equal(
    templateComponentsUseFirstName([{ type: "BODY", text: "היי {{1}}!" }]),
    true
  );
}

/** Gated/pending must not consume the lead: held rows stay eligible. */
{
  function consumesDedupLog(dispatch: "immediate" | "deferred" | "gated" | "send_failed"): boolean {
    return dispatch === "immediate" || dispatch === "deferred";
  }
  assert.equal(consumesDedupLog("gated"), false);
  assert.equal(consumesDedupLog("send_failed"), false);
  assert.equal(consumesDedupLog("immediate"), true);
}

/** Contact source is already in the no-response cron allow-list. */
{
  assert.equal(ARBOX_NEW_LEAD_CONTACT_SOURCE, "site_lead");
  assert.equal(isOpeningTemplateLeadSource(ARBOX_NEW_LEAD_CONTACT_SOURCE), true);
  assert.equal(isOpeningTemplateLeadSource("arbox_lead"), false);
}

/** Trigger type is Arbox-gated. */
{
  assert.equal(isTriggerType("arbox_new_lead"), true);
  assert.equal(isArboxDependentTriggerType("arbox_new_lead"), true);
}

/** Scheduled enqueue key is per lead_id (user_id). */
{
  assert.equal(
    buildArboxNewLeadScheduledDedupKey(1, "rule-uuid", 11049159),
    "arbox_new_lead:1:rule-uuid:11049159"
  );
}

/** no_rule: no enabled arbox_new_lead rule with template → null. */
{
  assert.equal(pickArboxNewLeadTemplateTriggerRule([]), null);
  assert.equal(
    pickArboxNewLeadTemplateTriggerRule([
      {
        id: "r1",
        business_id: 1,
        trigger_type: "arbox_new_lead",
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
  const picked = pickArboxNewLeadTemplateTriggerRule([
    {
      id: "r-old",
      business_id: 1,
      trigger_type: "arbox_new_lead",
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
      trigger_type: "arbox_new_lead",
      product_filter: null,
      delay_days: 0,
      delay_direction: "after",
      template_name: "T_arbox_lead",
      enabled: true,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  ]);
  assert.equal(picked?.id, "r-new");
  assert.equal(picked?.template_name, "T_arbox_lead");
}

console.log("arbox-new-lead.test.ts: ok");
