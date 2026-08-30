import assert from "node:assert/strict";
import {
  dashboardWhatsAppChannelSwrKey,
  dashboardZoeActivatedSwrKey,
} from "@/lib/dashboard-whatsapp-channel-swr";

assert.equal(
  dashboardWhatsAppChannelSwrKey("Master-Yigal-Arbiv-IKMA-Israel"),
  dashboardWhatsAppChannelSwrKey("master-yigal-arbiv-ikma-israel")
);
assert.equal(
  dashboardZoeActivatedSwrKey(" Master-Yigal-Arbiv-IKMA-Israel "),
  "zoe-activated:master-yigal-arbiv-ikma-israel"
);

console.log("dashboard-whatsapp-channel-swr tests passed");
