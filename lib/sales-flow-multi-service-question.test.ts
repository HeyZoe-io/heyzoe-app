import assert from "node:assert/strict";
import {
  DEFAULT_MULTI_SERVICE_QUESTION_TAIL,
  parseSalesFlowFromSocial,
} from "@/lib/sales-flow";

const NEW_DEFAULT =
  "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך, איזה אימון הכי קורץ לך?\nאני אתן לך עליו עוד פרטים! (תהיה אפשרות לבחור אימון אחר ולקבל גם עליו מידע מיד אחרי)";
const PREVIOUS_DEFAULT =
  "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך? אני אתן לך עליו עוד פרטים!\n(תהיה אפשרות לבחור אימון אחר ולקבל גם עליו מידע מיד אחרי)";
const OLD_DEFAULT =
  "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך?";
const MID_DEFAULT =
  "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך? אני אתן לך עליו עוד פרטים!";
const CUSTOM = "איזה אימון מעניין אותך הכי הרבה אצלנו?";

assert.equal(DEFAULT_MULTI_SERVICE_QUESTION_TAIL, NEW_DEFAULT);

assert.equal(
  parseSalesFlowFromSocial({})?.multi_service_question,
  NEW_DEFAULT
);

for (const saved of [OLD_DEFAULT, MID_DEFAULT, PREVIOUS_DEFAULT, CUSTOM, NEW_DEFAULT]) {
  assert.equal(
    parseSalesFlowFromSocial({ multi_service_question: saved })?.multi_service_question,
    saved
  );
}

console.log("sales-flow-multi-service-question.test.ts: ok");
