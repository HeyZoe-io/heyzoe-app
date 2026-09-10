import assert from "node:assert/strict";
import { canManageAccountUsers, parseAccountUsersSlug } from "@/lib/account/users-request";

assert.equal(parseAccountUsersSlug(new URLSearchParams("slug=Joe-Studio")), "joe-studio");
assert.equal(parseAccountUsersSlug(new URLSearchParams("slug=%20yoga-place%20")), "yoga-place");
assert.equal(parseAccountUsersSlug(new URLSearchParams(), { slug: "Other-Biz" }), "other-biz");
assert.equal(parseAccountUsersSlug(new URLSearchParams("slug=client-a"), { slug: "client-b" }), "client-a");
assert.equal(parseAccountUsersSlug(new URLSearchParams()), "");
assert.equal(parseAccountUsersSlug(new URLSearchParams("debug=1")), "");

assert.equal(canManageAccountUsers({ isPlatformAdmin: true, membershipRole: null }), true);
assert.equal(canManageAccountUsers({ isPlatformAdmin: true, membershipRole: "employee" }), true);
assert.equal(canManageAccountUsers({ isPlatformAdmin: false, membershipRole: "admin" }), true);
assert.equal(canManageAccountUsers({ isPlatformAdmin: false, membershipRole: "employee" }), false);
assert.equal(canManageAccountUsers({ isPlatformAdmin: false, membershipRole: null }), false);

console.log("account/users-request.test.ts: ok");
