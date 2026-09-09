import assert from "node:assert/strict";
import {
  DEFAULT_MULTI_SERVICE_QUESTION_TAIL,
  parseSalesFlowFromSocial,
} from "@/lib/sales-flow";

const NEW_DEFAULT =
  "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך? אני אתן לך עליו עוד פרטים!\n(תהיה אפשרות לבחור אימון אחר ולקבל גם עליו מידע מיד אחרי)";
const OLD_DEFAULT =
  "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך?";
const MID_DEFAULT =
  "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך? אני אתן לך עליו עוד פרטים!";
const CUSTOM = "איזה אימון מעניין אותך הכי הרבה אצלנו?";

assert.equal(DEFAULT_MULTI_SERVICE_QUESTION_TAIL, NEW_DEFAULT);

assert.equal(
  parseSalesFlowFromSocial({ multi_service_question: OLD_DEFAULT })?.multi_service_question,
  NEW_DEFAULT
);
assert.equal(
  parseSalesFlowFromSocial({ multi_service_question: MID_DEFAULT })?.multi_service_question,
  NEW_DEFAULT
);

const keptCustom = parseSalesFlowFromSocial({ multi_service_question: CUSTOM });
assert.equal(keptCustom?.multi_service_question, CUSTOM);

const alreadyNew = parseSalesFlowFromSocial({ multi_service_question: NEW_DEFAULT });
assert.equal(alreadyNew?.multi_service_question, NEW_DEFAULT);

console.log("sales-flow-multi-service-question.test.ts: ok");
