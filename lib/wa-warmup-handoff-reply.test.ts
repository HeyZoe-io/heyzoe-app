import assert from "node:assert/strict";
import { isWarmupHandoffReply } from "@/lib/wa-warmup-handoff-reply";

assert.equal(isWarmupHandoffReply("מועבר לנציג"), true);
assert.equal(isWarmupHandoffReply("מעולה, מעבירה אותך לנציג 😊"), true);
assert.equal(isWarmupHandoffReply("נציג אנושי יחזור אלייך בערב"), true);
assert.equal(isWarmupHandoffReply("Transferring you to an agent"), true);

assert.equal(isWarmupHandoffReply(""), false);
assert.equal(isWarmupHandoffReply("הידעת? הסוד לגוף חזק שנע בקלות הוא שילוב של גמישות וכוח"), false);
assert.equal(
  isWarmupHandoffReply("מהמם, נשמח להעמיק איתך יותר! עלות שיעור ניסיון מוזלת דרך השיחה איתי כאן: 10₪."),
  false
);

console.log("wa-warmup-handoff-reply: ok");
