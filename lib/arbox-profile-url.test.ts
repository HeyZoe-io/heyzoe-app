import assert from "node:assert/strict";
import { buildArboxUserProfileUrl } from "@/lib/arbox-profile-url";

{
  const url = buildArboxUserProfileUrl({ crmType: "arbox", arboxUserId: "9920528" });
  assert.equal(url, "https://manage.arboxapp.com/user-profile/9920528");
}

{
  const leadUrl = buildArboxUserProfileUrl({ crmType: "arbox", arboxUserId: "9959580" });
  assert.equal(leadUrl, "https://manage.arboxapp.com/user-profile/9959580");
}

{
  assert.equal(buildArboxUserProfileUrl({ crmType: "arbox", arboxUserId: null }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "arbox", arboxUserId: "" }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "arbox", arboxUserId: "   " }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "arbox" }), null);
}

{
  assert.equal(buildArboxUserProfileUrl({ crmType: "boostapp", arboxUserId: "9920528" }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "plan_do", arboxUserId: "9920528" }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "", arboxUserId: "9920528" }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: null, arboxUserId: "9920528" }), null);
}

console.log("arbox-profile-url.test.ts: ok");
