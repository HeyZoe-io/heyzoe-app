import assert from "node:assert/strict";
import {
  callDayTemplateBakesInHour,
  formatMarketingCallTimeParam,
  MARKETING_CALL_TIME_OMIT,
  mergeMarketingCallDayBodyParams,
  preferLiveCallTime,
  renderMarketingCallDayFallbackText,
  resolveMarketingTemplateBodyParams,
} from "@/lib/marketing-template-presets";

{
  assert.equal(preferLiveCallTime("בקרוב", "10:00:00"), "10:00");
  assert.equal(preferLiveCallTime("בקרוב", null), "");
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
  const shaahBody = "היי {{1}}, מזכירה שיש לנו שיחה היום בשעה {{2}} 📅";
  assert.equal(callDayTemplateBakesInHour(shaahBody), true);
  assert.equal(formatMarketingCallTimeParam("10:00", shaahBody), "10:00");
  assert.equal(formatMarketingCallTimeParam(null, shaahBody), "");
  assert.equal(formatMarketingCallTimeParam(null, "היי {{1}}, שיחה היום{{2}} 📅"), MARKETING_CALL_TIME_OMIT);
  assert.equal(formatMarketingCallTimeParam("14:30", "היי {{1}}, שיחה היום{{2}} 📅"), "בשעה 14:30");
}

{
  const params = resolveMarketingTemplateBodyParams({
    triggerType: "call_day",
    varCount: 2,
    firstName: "Eva",
    callTime: null,
    bodyText: "היי {{1}}, מזכירה שיש לנו שיחה היום בשעה {{2}} 📅",
  });
  assert.deepEqual(params, ["Eva", ""]);
}

{
  const params = resolveMarketingTemplateBodyParams({
    triggerType: "call_day",
    varCount: 2,
    firstName: "Eva",
    callTime: "10:00:00",
    bodyText: "היי {{1}}, מזכירה שיש לנו שיחה היום בשעה {{2}} 📅",
  });
  assert.deepEqual(params, ["Eva", "10:00"]);
}

{
  const text = renderMarketingCallDayFallbackText({
    firstName: "תמי",
    body: "היי {{1}}, מזכירה שיש לנו שיחה היום בשעה {{2}} 📅 \nבמידה ויש בעיה כלשהי נשמח לעדכון. אחרת - מצפים לדבר איתך :)",
  });
  assert.equal(
    text,
    "היי תמי, מזכירה שיש לנו שיחה היום  📅\nבמידה ויש בעיה כלשהי נשמח לעדכון. אחרת - מצפים לדבר איתך :)"
  );
  assert.doesNotMatch(text, /בשעה/);
  assert.doesNotMatch(text, /בקרוב/);
}

console.log("marketing-template-presets.test.ts: ok");
