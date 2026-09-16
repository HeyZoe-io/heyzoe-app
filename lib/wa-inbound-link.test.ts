import assert from "node:assert/strict";
import { looksLikeLinkOnlyMessage, stripInboundUrlTokens } from "@/lib/wa-inbound-link";
import { detectMessageLanguage } from "@/lib/language-detect";

assert.equal(looksLikeLinkOnlyMessage("https://maps.app.goo.gl/abc123"), true);
assert.equal(looksLikeLinkOnlyMessage("  https://www.instagram.com/p/xyz/  "), true);
assert.equal(looksLikeLinkOnlyMessage("www.youtube.com/watch?v=dQw4w9wgGcQ"), true);
assert.equal(looksLikeLinkOnlyMessage("https://arbox.link/BexfHxiS."), true);
assert.equal(looksLikeLinkOnlyMessage("wa.me/972501234567"), true);
assert.equal(looksLikeLinkOnlyMessage("http://example.com/path?x=1"), true);

assert.equal(looksLikeLinkOnlyMessage("תראי את זה https://example.com"), false);
assert.equal(looksLikeLinkOnlyMessage("הנה הלינק לתשלום https://arbox.link/x"), false);
assert.equal(looksLikeLinkOnlyMessage("היי"), false);
assert.equal(looksLikeLinkOnlyMessage("מתי יש אימון"), false);
assert.equal(looksLikeLinkOnlyMessage("Yoga 18:00"), false);
assert.equal(looksLikeLinkOnlyMessage(""), false);
assert.equal(looksLikeLinkOnlyMessage("hello"), false);

assert.equal(stripInboundUrlTokens("תראי https://example.com עכשיו"), "תראי עכשיו");
assert.equal(detectMessageLanguage("https://maps.app.goo.gl/abc123"), "unknown");
assert.equal(detectMessageLanguage("תראי את זה https://example.com/path"), "he");
assert.equal(detectMessageLanguage("Hi, can I book a trial class?"), "en");

console.log("wa-inbound-link.test.ts: ok");
