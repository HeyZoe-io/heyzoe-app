import assert from "node:assert/strict";
import { approvedTemplateSyncPatch } from "@/lib/meta-templates";

const nowIso = "2026-08-22T12:00:00.000Z";

const patch = approvedTemplateSyncPatch(
  {
    id: "1259544702043867",
    name: "incoming_lead",
    status: "APPROVED",
    category: "MARKETING",
    language: "he",
    components: [
      { type: "BODY", text: "היי {{1}}, ברוכים הבאים" },
      { type: "FOOTER", text: "הסטודיו" },
    ],
  },
  "PENDING",
  nowIso
);

assert.equal(patch.status, "APPROVED");
assert.equal(patch.waba_template_id, "1259544702043867");
assert.equal(patch.category, "MARKETING");
assert.equal(patch.updated_at, nowIso);
assert.equal(Array.isArray(patch.components), true);
assert.equal((patch.components[0] as { text?: string }).text, "היי {{1}}, ברוכים הבאים");

const fallback = approvedTemplateSyncPatch(
  {
    id: "999",
    name: "x",
    status: "",
    category: "",
    language: "he",
  },
  "REJECTED",
  nowIso
);
assert.equal(fallback.status, "REJECTED");
assert.deepEqual(fallback.components, []);
assert.equal("category" in fallback, false);

console.log("meta-templates.test.ts: ok");
