import assert from "node:assert/strict";
import {
  explicitProductDeleteDecision,
  isBulkProductDeleteResponse,
  mergeProductsAfterConflict,
  preserveArboxDescriptionKeys,
  productEditFingerprint,
  type ProductMergeRow,
} from "@/lib/dashboard-settings-service-save";

function row(partial: Partial<ProductMergeRow> & Pick<ProductMergeRow, "ui_id" | "name" | "service_slug">): ProductMergeRow {
  return {
    price_text: "50",
    payment_link: "https://arbox.link/example",
    description: partial.name,
    offer_kind: "trial",
    schedule_slots: [],
    ...partial,
  };
}

const keyOf = (r: ProductMergeRow) => r.service_slug.trim() || r.ui_id;

// A product missing from the submitted list is not deleted.
{
  const decision = explicitProductDeleteDecision({
    existingSlugs: ["arbox-1", "arbox-2"],
    requestedDeletes: [],
    confirm: false,
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.deepEqual(decision.slugs, []);
}

// One explicit delete is allowed when it is not more than 30% of the catalog.
{
  const decision = explicitProductDeleteDecision({
    existingSlugs: ["arbox-1", "arbox-2", "arbox-3", "arbox-4"],
    requestedDeletes: ["arbox-2", "missing", "arbox-2"],
    confirm: false,
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.deepEqual(decision.slugs, ["arbox-2"]);
}

// Three or more deletes need an explicit confirm, then succeed.
{
  const slugs = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const requested = ["a", "b", "c"];
  const blocked = explicitProductDeleteDecision({
    existingSlugs: slugs,
    requestedDeletes: requested,
    confirm: false,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.error, "bulk_product_delete_confirm");
    assert.equal(blocked.deleteCount, 3);
  }
  const allowed = explicitProductDeleteDecision({
    existingSlugs: slugs,
    requestedDeletes: requested,
    confirm: true,
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.deepEqual(allowed.slugs, requested);
  assert.equal(isBulkProductDeleteResponse(400, { error: "bulk_product_delete_confirm" }), true);
  assert.equal(isBulkProductDeleteResponse(409, { error: "settings_conflict" }), false);
}

// Two deletes that are more than 30% of a small catalog also need confirm.
{
  const blocked = explicitProductDeleteDecision({
    existingSlugs: ["a", "b", "c", "d", "e"],
    requestedDeletes: ["a", "b"],
    confirm: false,
  });
  assert.equal(blocked.ok, false);
}

// Tab B's product survives a save from tab A. A local-only product stays.
{
  const server = [
    row({ ui_id: "s1", name: "כוח", service_slug: "arbox-1" }),
    row({ ui_id: "s2", name: "כוח נערות", service_slug: "arbox-2" }),
  ];
  const local = [
    row({ ui_id: "l1", name: "כוח", service_slug: "arbox-1" }),
    row({ ui_id: "new", name: "טיוטה", service_slug: "", description: "עדיין לא נשמר" }),
  ];
  const baseline = new Map<string, string>([["arbox-1", productEditFingerprint(local[0]!)]]);
  const merged = mergeProductsAfterConflict({
    server,
    local,
    baselineByKey: baseline,
    keyOf,
    deletedSlugs: new Set(),
  });
  assert.deepEqual(
    merged.map((r) => r.service_slug || r.name),
    ["arbox-1", "arbox-2", "טיוטה"]
  );
  assert.equal(merged[2]?.description, "עדיין לא נשמר");
}

// A local edit wins. An untouched product keeps the server copy.
{
  const server = [
    row({ ui_id: "s1", name: "כוח", service_slug: "arbox-1", description: "מהשרת" }),
    row({ ui_id: "s2", name: "יוגה", service_slug: "arbox-2", description: "קרון עדכן" }),
  ];
  const localEdited = row({
    ui_id: "l1",
    name: "כוח",
    service_slug: "arbox-1",
    description: "עריכה מקומית",
  });
  const localUntouched = row({
    ui_id: "l2",
    name: "יוגה",
    service_slug: "arbox-2",
    description: "ישן",
  });
  const baseline = new Map<string, string>([
    ["arbox-1", productEditFingerprint(row({ ui_id: "l1", name: "כוח", service_slug: "arbox-1", description: "מהשרת" }))],
    ["arbox-2", productEditFingerprint(localUntouched)],
  ]);
  const merged = mergeProductsAfterConflict({
    server,
    local: [localEdited, localUntouched],
    baselineByKey: baseline,
    keyOf,
    deletedSlugs: new Set(),
  });
  assert.equal(merged[0]?.description, "עריכה מקומית");
  assert.equal(merged[0]?.ui_id, "l1");
  assert.equal(merged[1]?.description, "קרון עדכן");
  assert.equal(merged[1]?.ui_id, "l2");
}

// An explicit delete stays deleted even if the server still has the row.
{
  const merged = mergeProductsAfterConflict({
    server: [row({ ui_id: "s1", name: "כוח", service_slug: "arbox-1" })],
    local: [],
    baselineByKey: new Map(),
    keyOf,
    deletedSlugs: new Set(["arbox-1"]),
  });
  assert.equal(merged.length, 0);
}

// Arbox stamp keys survive a description rewrite.
{
  const saved = preserveArboxDescriptionKeys(
    { description_text: "טקסט מהטופס", price_text: "50" },
    {
      arbox_box_category_id: 167892,
      arbox_class_name: "כוח נערות",
      schedule_slots: [{ id: "a", day: "א", time: "16:00" }],
      schedule_removed_notice: null,
      prior: { arbox_class_description: "מארבוקס", schedule_removed_notice: { detected_at: "t", dismissed: false } },
    }
  );
  assert.equal(saved.arbox_box_category_id, 167892);
  assert.equal(saved.arbox_class_name, "כוח נערות");
  assert.equal(Array.isArray(saved.schedule_slots), true);
  assert.deepEqual(saved.schedule_removed_notice, null);
  assert.equal(saved.arbox_class_description, "מארבוקס");
  assert.equal(saved.description_text, "טקסט מהטופס");
}

console.log("dashboard-settings-service-save.test.ts: ok");
