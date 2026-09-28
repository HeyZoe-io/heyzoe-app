import assert from "node:assert/strict";
import { needsArboxUserSearch } from "@/lib/arbox-needs-user-search";

assert.equal(needsArboxUserSearch({ userId: null, profileId: null }), true);
assert.equal(needsArboxUserSearch({ userId: "", profileId: "" }), true);
assert.equal(needsArboxUserSearch({ userId: "111", profileId: null }), true, "cached user still needs profile");
assert.equal(needsArboxUserSearch({ userId: "111", profileId: "" }), true);
assert.equal(needsArboxUserSearch({ userId: null, profileId: "4648373" }), true, "profile without user still searches");
assert.equal(needsArboxUserSearch({ userId: "111", profileId: "4648373" }), false, "both cached — no search");
assert.equal(needsArboxUserSearch({}), true);

console.log("arbox-needs-user-search.test.ts: ok");
