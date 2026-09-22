import assert from "node:assert/strict";
import { looksLikeEmailOnlyMessage, stripInboundEmailTokens } from "@/lib/wa-inbound-email";
import { detectMessageLanguage } from "@/lib/language-detect";

assert.equal(looksLikeEmailOnlyMessage("lior@gmail.com"), true);
assert.equal(looksLikeEmailOnlyMessage("  lior@gmail.com  "), true);
assert.equal(looksLikeEmailOnlyMessage("lior@gmail.com."), true);
assert.equal(looksLikeEmailOnlyMessage("<lior@gmail.com>"), true);
assert.equal(looksLikeEmailOnlyMessage("mailto:lior@gmail.com"), true);
assert.equal(looksLikeEmailOnlyMessage("lior@studio.co.il"), true);
assert.equal(looksLikeEmailOnlyMessage("lior+tag@gmail.com"), true);
assert.equal(looksLikeEmailOnlyMessage("המייל שלי: lior@gmail.com"), true);
assert.equal(looksLikeEmailOnlyMessage("אימייל lior@gmail.com"), true);
assert.equal(looksLikeEmailOnlyMessage("אי-מייל: lior@gmail.com"), true);
assert.equal(looksLikeEmailOnlyMessage('דוא"ל: lior@gmail.com'), true);
assert.equal(looksLikeEmailOnlyMessage("email: lior@gmail.com"), true);
assert.equal(looksLikeEmailOnlyMessage("My email is lior@gmail.com"), true);
assert.equal(looksLikeEmailOnlyMessage("a@b.com c@d.co.il"), true);

assert.equal(looksLikeEmailOnlyMessage("lior@gmail.com מתי יש שיעור?"), false);
assert.equal(looksLikeEmailOnlyMessage("תודה lior@gmail.com"), false);
assert.equal(looksLikeEmailOnlyMessage("היי, lior@gmail.com אפשר להירשם?"), false);
assert.equal(looksLikeEmailOnlyMessage("Please book me a trial lior@gmail.com"), false);
assert.equal(looksLikeEmailOnlyMessage("מתי יש יוגה?"), false);
assert.equal(looksLikeEmailOnlyMessage("hello"), false);
assert.equal(looksLikeEmailOnlyMessage(""), false);
assert.equal(looksLikeEmailOnlyMessage("https://example.com"), false);

assert.equal(stripInboundEmailTokens("המייל שלי lior@gmail.com"), "המייל שלי");
assert.equal(detectMessageLanguage("lior@gmail.com"), "unknown");
assert.equal(detectMessageLanguage("המייל שלי: lior@gmail.com"), "he");
assert.equal(detectMessageLanguage("מתי יש שיעור? lior@gmail.com"), "he");
assert.equal(detectMessageLanguage("Hi, can I book a trial? lior@gmail.com"), "en");
assert.equal(detectMessageLanguage("Привет, lior@gmail.com"), "ru");

console.log("wa-inbound-email.test.ts: ok");
