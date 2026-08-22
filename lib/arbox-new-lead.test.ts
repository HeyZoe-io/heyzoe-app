import assert from "node:assert/strict";
import {
  buildAllLeadsReportPath,
  clampAllLeadsReportDateRange,
  parseLeadIdFromUserId,
  resolveAllLeadsReportDateRange,
  seedAllLeadsReportDateRange,
  ARBOX_NEW_LEAD_CONTACT_SOURCE,
  isArboxUncontactedLeadStatus,
  isArboxZoeCreatedLeadSource,
  templateComponentsUseFirstName,
} from "@/lib/leads/arbox-new-lead";
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

/** Seed-first-run: uncontacted rows are not seeded; other statuses are. */
{
  function shouldSeedRow(status: string, seeded: boolean): boolean {
    if (seeded) return false;
    return !isArboxUncontactedLeadStatus(status);
  }
  assert.equal(shouldSeedRow("Lost", false), true);
  assert.equal(shouldSeedRow("לא נוצר קשר", false), false);
  assert.equal(shouldSeedRow("Converted to Member", false), true);
  assert.equal(shouldSeedRow("לא נוצר קשר", true), false);
}

/** Uncontacted status matcher ignores extra whitespace. */
{
  assert.equal(isArboxUncontactedLeadStatus("לא נוצר קשר"), true);
  assert.equal(isArboxUncontactedLeadStatus("  לא  נוצר קשר "), true);
  assert.equal(isArboxUncontactedLeadStatus("ניסיון 1"), false);
  assert.equal(isArboxUncontactedLeadStatus("Lost"), false);
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
