import assert from "node:assert/strict";
import { utilityRecategoryNoticeColumns } from "@/lib/template-category-notice";

const now = "2026-09-27T12:00:00.000Z";

{
  const patch = utilityRecategoryNoticeColumns("UTILITY", "MARKETING", now);
  assert.equal(patch?.meta_recategorized_from, "UTILITY");
  assert.equal(patch?.meta_recategorized_at, now);
  assert.equal(patch?.category_notice_dismissed_at, null);
}

{
  const patch = utilityRecategoryNoticeColumns(" utility ", "marketing", now);
  assert.equal(patch?.meta_recategorized_from, "UTILITY");
}

assert.equal(utilityRecategoryNoticeColumns("MARKETING", "MARKETING", now), null);
assert.equal(utilityRecategoryNoticeColumns("", "MARKETING", now), null);

{
  const patch = utilityRecategoryNoticeColumns("MARKETING", "UTILITY", now);
  assert.equal(patch?.meta_recategorized_from, null);
  assert.equal(patch?.meta_recategorized_at, null);
  assert.equal(patch?.category_notice_dismissed_at, null);
}

console.log("template-category-notice.test.ts: ok");
