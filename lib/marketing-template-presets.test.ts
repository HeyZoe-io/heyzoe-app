import assert from "node:assert/strict";
import {
  MARKETING_CALL_TIME_FALLBACK,
  mergeMarketingCallDayBodyParams,
  preferLiveCallTime,
  resolveMarketingTemplateBodyParams,
} from "@/lib/marketing-template-presets";

{
  assert.equal(preferLiveCallTime("בקרוב", "10:00:00"), "10:00");
  assert.equal(preferLiveCallTime("בקרוב", null), MARKETING_CALL_TIME_FALLBACK);
  assert.equal(preferLiveCallTime("14:00", null), "14:00");
  assert.equal(preferLiveCallTime("14:00", "11:30"), "11:30");
}

{
  const merged = mergeMarketingCallDayBodyParams(["Eva", "בקרוב"], ["Eva", "10:00"]);
  assert.deepEqual(merged, ["Eva", "10:00"]);
}

{
  const keep = mergeMarketingCallDayBodyParams(["Eva", "10:00"], ["Eva", "בקרוב"]);
  assert.deepEqual(keep, ["Eva", "10:00"]);
}

{
  const params = resolveMarketingTemplateBodyParams({
    triggerType: "call_day",
    varCount: 2,
    firstName: "Eva",
    callTime: null,
  });
  assert.deepEqual(params, ["Eva", MARKETING_CALL_TIME_FALLBACK]);
}

{
  const params = resolveMarketingTemplateBodyParams({
    triggerType: "call_day",
    varCount: 2,
    firstName: "Eva",
    callTime: "10:00:00",
  });
  assert.deepEqual(params, ["Eva", "10:00"]);
}

console.log("marketing-template-presets.test.ts: ok");
