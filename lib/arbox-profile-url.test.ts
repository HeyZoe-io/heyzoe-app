import assert from "node:assert/strict";
import {
  buildArboxUserProfileUrl,
  extractArboxProfileIdFromLink,
} from "@/lib/arbox-profile-url";

{
  assert.equal(
    extractArboxProfileIdFromLink("https://manage.arboxapp.com/user-profile/4648373"),
    "4648373"
  );
  assert.equal(
    extractArboxProfileIdFromLink("https://manage.arboxapp.com/user-profile/2419600"),
    "2419600"
  );
  assert.equal(
    extractArboxProfileIdFromLink("https://manage.arboxapp.com/user-profile/4648373?x=1"),
    "4648373"
  );
  assert.equal(extractArboxProfileIdFromLink(null), null);
  assert.equal(extractArboxProfileIdFromLink(""), null);
  assert.equal(extractArboxProfileIdFromLink("   "), null);
  assert.equal(extractArboxProfileIdFromLink("not-a-url"), null);
  assert.equal(extractArboxProfileIdFromLink("https://manage.arboxapp.com/dashboard"), null);
  assert.equal(extractArboxProfileIdFromLink("https://manage.arboxapp.com/user-profile/"), null);
}

{
  const url = buildArboxUserProfileUrl({ crmType: "arbox", arboxProfileId: "4648373" });
  assert.equal(url, "https://manage.arboxapp.com/user-profile/4648373");
}

{
  assert.equal(buildArboxUserProfileUrl({ crmType: "arbox", arboxProfileId: null }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "arbox", arboxProfileId: "" }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "arbox" }), null);
}

{
  assert.equal(buildArboxUserProfileUrl({ crmType: "boostapp", arboxProfileId: "4648373" }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "plan_do", arboxProfileId: "4648373" }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "", arboxProfileId: "4648373" }), null);
  assert.equal(buildArboxUserProfileUrl({ crmType: "arbox", arboxUserId: "11143101" } as never), null);
}

console.log("arbox-profile-url.test.ts: ok");
