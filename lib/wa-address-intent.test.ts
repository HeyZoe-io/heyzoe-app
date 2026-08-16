import assert from "node:assert/strict";
import { isAddressOrDirectionsIntent } from "@/lib/wa-address-intent";

assert.equal(isAddressOrDirectionsIntent("איך מגיעים?"), true);
assert.equal(isAddressOrDirectionsIntent("אני מגיע ברגל, איך נכנסים ?"), true);
assert.equal(isAddressOrDirectionsIntent("כן אני רואה שאין לכם שיעורים בבקרים בכלל\nאני מגיע ברגל, איך נכנסים ?"), true);
assert.equal(isAddressOrDirectionsIntent("איך להיכנס לסטודיו"), true);
assert.equal(isAddressOrDirectionsIntent("כניסה ברגל"), true);
assert.equal(isAddressOrDirectionsIntent("איך עובד השיעור מה עושים בו ?"), false);
assert.equal(isAddressOrDirectionsIntent("אפשר לשלם במזומן ?"), false);

console.log("wa-address-intent.test.ts: ok");
