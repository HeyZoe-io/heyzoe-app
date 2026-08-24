import assert from "node:assert/strict";
import { foldHebrewServiceBlob, foldHebrewServiceToken } from "./hebrew-service-token";

assert.equal(foldHebrewServiceToken("מתחילים"), "מתחיל");
assert.equal(foldHebrewServiceToken("מתחילות"), "מתחיל");
assert.equal(foldHebrewServiceToken("למתחילות"), "מתחיל");
assert.equal(foldHebrewServiceToken("נשים"), "נשים");
assert.equal(foldHebrewServiceToken("יוגה"), "יוגה");
assert.match(foldHebrewServiceBlob("שיעורי יוגה למתחילות"), /מתחיל/);
assert.match(foldHebrewServiceBlob("שיעור יוגה מתחילים"), /מתחיל/);

console.log("hebrew-service-token.test.ts: ok");
