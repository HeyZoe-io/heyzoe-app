import assert from "node:assert/strict";
import { fillWarmupScriptedReply } from "@/lib/sales-flow";

const elinBroken =
  "מושלם. הגעת למקום הנכון. יש לנו אימונים שמתמקדים בחיזוק וחיטוב הגוף. {serviceName} טהורים עם תוכנית אימונים חודשית שמאפשרת השתפרות והתחזקות. {serviceName} משלבי סיבולת ואימונים פונקציונליים.";

assert.equal(
  fillWarmupScriptedReply(elinBroken).includes("{serviceName}"),
  false,
  "must not send leftover {serviceName} braces"
);

const restored =
  "מושלם. הגעת למקום הנכון. יש לנו אימונים שמתמקדים בחיזוק וחיטוב הגוף. Strength טהורים עם תוכנית אימונים חודשית שמאפשרת השתפרות והתחזקות. Strength משלבי סיבולת ואימונים פונקציונליים.";
assert.equal(fillWarmupScriptedReply(restored), restored);

assert.equal(
  fillWarmupScriptedReply("נעים. {serviceName} אצלנו.", "אימוני כוח"),
  "נעים. אימוני כוח אצלנו."
);

assert.equal(
  fillWarmupScriptedReply("יש Strength טהורים. (שם האימון)"),
  "יש Strength טהורים."
);

console.log("sales-flow-warmup-reply.test.ts: ok");
