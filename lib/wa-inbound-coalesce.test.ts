import assert from "node:assert/strict";
import { joinInboundUserTexts } from "@/lib/wa-inbound-coalesce";

assert.equal(joinInboundUserTexts("איפה החניה", [{ content: "אפשר לשלם במזומן ?" }]), "איפה החניה\nאפשר לשלם במזומן ?");
assert.equal(joinInboundUserTexts("שלום", [{ content: "שלום" }]), "שלום");
assert.equal(joinInboundUserTexts("  ", [{ content: "היי" }]), "היי");
assert.equal(
  joinInboundUserTexts("אני מגיע לבד, זה בסדר?", [{ content: "איך עובד השיעור מה עושים בו ?" }]),
  "אני מגיע לבד, זה בסדר?\nאיך עובד השיעור מה עושים בו ?"
);

console.log("wa-inbound-coalesce.test.ts: ok");
