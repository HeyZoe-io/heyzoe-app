import assert from "node:assert/strict";
import {
  messageMatchesAutomatedTemplate,
  templateStaticChunks,
} from "./template-duplicate-guard";

const reminderBody =
  "היי {{1}}, 🤍\nרק מזכירות שמחכות לך לאימון הניסיון שלך בStudio Tights ✨\n{{2}}, ביום {{3}} בשעה {{4}}";
const chunks = templateStaticChunks(reminderBody);

assert.ok(chunks.some((chunk) => chunk.includes("רק מזכירות")));

const sent =
  "היי עדי, 🤍 רק מזכירות שמחכות לך לאימון הניסיון שלך בStudio Tights ✨ אימון Power, ביום חמישי 8.10 בשעה 19:00";

assert.equal(
  messageMatchesAutomatedTemplate({
    content: sent,
    staticChunks: chunks,
    params: ["עדי", "אימון Power", "יום חמישי 8.10", "19:00"],
  }),
  true
);

assert.equal(
  messageMatchesAutomatedTemplate({
    content: sent,
    staticChunks: chunks,
    params: ["שני", "אימון Power", "יום חמישי 8.10", "20:00"],
  }),
  false
);

assert.equal(
  messageMatchesAutomatedTemplate({
    content: "היי Michal",
    staticChunks: [],
    params: ["Michal"],
  }),
  false
);

console.log("template-duplicate-guard.test.ts ok");
