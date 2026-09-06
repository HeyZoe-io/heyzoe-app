import assert from "node:assert/strict";
import {
  buildInlineTemplateDraft,
  defaultTriggerTemplateMode,
  isApprovedTemplateRow,
  shouldShowTriggerPendingPill,
  templateStatusForTriggerName,
} from "@/lib/trigger-inline-template";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  ARBOX_SYNC_SEND_ATTEMPT_CAP,
  nextCancellationSyncLogAfterDispatch,
} from "@/lib/leads/arbox-membership-cancelled";

assert.equal(defaultTriggerTemplateMode({}), "create_new");
assert.equal(
  defaultTriggerTemplateMode({ preferExistingName: "purchase_thanks" }),
  "use_existing"
);
assert.equal(
  defaultTriggerTemplateMode({ hasApprovedTemplate: true }),
  "create_new",
  "create-new stays the default unified path even when approved templates exist"
);

{
  const draft = buildInlineTemplateDraft("freeze_created", ["freeze_created"]);
  assert.ok(draft);
  assert.equal(draft!.category, TEMPLATE_PRESETS.freeze_created.category);
  assert.equal(draft!.body, TEMPLATE_PRESETS.freeze_created.body);
  assert.equal(draft!.language, "he");
  assert.equal(draft!.header, "");
  assert.equal(draft!.footer, "");
  assert.match(draft!.name, /^freeze_created/);
  assert.notEqual(draft!.name, "freeze_created", "unique suffix when name taken");
}

{
  const draft = buildInlineTemplateDraft("attendance_gap", []);
  assert.ok(draft);
  assert.equal(draft!.category, "MARKETING");
  assert.equal(draft!.buttons[0]?.kind, "QUICK_REPLY");
  assert.equal(draft!.buttons[0]?.text, "אשמח לחזור");
}

{
  const templates = [
    { name: "a", status: "PENDING" },
    { name: "b", status: "APPROVED" },
    { name: "c", status: "APPROVED", disabled: true },
  ];
  assert.equal(templateStatusForTriggerName(templates, "a"), "PENDING");
  assert.equal(templateStatusForTriggerName(templates, "b"), "APPROVED");
  assert.equal(templateStatusForTriggerName(templates, "c"), null);
  assert.equal(templateStatusForTriggerName(templates, null), null);
  assert.equal(shouldShowTriggerPendingPill("PENDING"), true);
  assert.equal(shouldShowTriggerPendingPill("APPROVED"), false);
  assert.equal(shouldShowTriggerPendingPill(null), false);
  assert.equal(isApprovedTemplateRow(templates[1]!), true);
  assert.equal(isApprovedTemplateRow(templates[0]!), false);
  assert.equal(isApprovedTemplateRow(templates[2]!), false);
}

/** Runtime gated path unchanged — PENDING wait does not burn retry cap. */
{
  assert.equal(ARBOX_SYNC_SEND_ATTEMPT_CAP, 3);
  const gated = nextCancellationSyncLogAfterDispatch({ dispatch: "gated", attemptsSoFar: 0 });
  assert.deepEqual(gated, { attempts: 0, status: "pending", hitCap: false });
  const gated2 = nextCancellationSyncLogAfterDispatch({
    dispatch: "gated",
    attemptsSoFar: 2,
  });
  assert.deepEqual(gated2, { attempts: 2, status: "pending", hitCap: false });
  const sent = nextCancellationSyncLogAfterDispatch({
    dispatch: "immediate",
    attemptsSoFar: 0,
  });
  assert.equal(sent.status, "sent");
}

console.log("trigger-inline-template.test.ts: ok");
