import assert from "node:assert/strict";
import { appendPageSearch, parseOwnerDashboardPath, preferredDashboardHref } from "@/lib/dashboard-owner-path";
import { pickPreferredBusiness, type DashboardBizRow } from "@/lib/dashboard-business-access";

const utm = { utm_source: "whatsapp", utm_medium: "button" };

assert.equal(appendPageSearch("/templates", {}), "/templates");
assert.equal(
  appendPageSearch("/templates", utm),
  "/templates?utm_source=whatsapp&utm_medium=button"
);
assert.equal(
  appendPageSearch("/templates", { utm_campaign: ["a", "b"] }),
  "/templates?utm_campaign=a&utm_campaign=b"
);

const returnPath = appendPageSearch("/templates", utm);
assert.equal(parseOwnerDashboardPath(returnPath), null);
assert.equal(
  preferredDashboardHref("limitless", returnPath),
  "/limitless/templates?utm_source=whatsapp&utm_medium=button"
);
assert.deepEqual(parseOwnerDashboardPath("/limitless/templates?utm_source=whatsapp"), {
  slug: "limitless",
  rest: "/templates?utm_source=whatsapp",
});

const owner = "user-1";
const older: DashboardBizRow = {
  id: 1,
  slug: "older",
  user_id: owner,
  created_at: "2024-01-01T00:00:00.000Z",
  is_active: true,
};
const newer: DashboardBizRow = {
  id: 2,
  slug: "newer",
  user_id: owner,
  created_at: "2025-06-01T00:00:00.000Z",
  is_active: true,
};
const inactive: DashboardBizRow = {
  id: 3,
  slug: "paused",
  user_id: owner,
  created_at: "2020-01-01T00:00:00.000Z",
  is_active: false,
};
const membership: DashboardBizRow = {
  id: 4,
  slug: "partner-studio",
  user_id: "someone-else",
  created_at: "2023-01-01T00:00:00.000Z",
  is_active: true,
};

assert.equal(pickPreferredBusiness([], owner), null);
assert.equal(pickPreferredBusiness([newer], owner)?.slug, "newer");
assert.equal(pickPreferredBusiness([newer, older], owner)?.slug, "older");
assert.equal(pickPreferredBusiness([inactive, newer], owner)?.slug, "newer");
assert.equal(pickPreferredBusiness([membership], owner)?.slug, "partner-studio");
assert.equal(pickPreferredBusiness([membership, older], owner)?.slug, "older");

console.log("templates-shortcut.test.ts: ok");
