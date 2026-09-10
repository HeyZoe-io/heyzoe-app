import assert from "node:assert/strict";
import { TRIGGER_CATALOG } from "@/lib/trigger-catalog";
import {
  HELP_CHAT_OPT_OUT_HE,
  HELP_CHAT_TRIGGERS_WHERE_HE,
  formatCatalogForHelpPrompt,
  formatOwnerHelpDeterministicTemplatesReply,
  formatOwnerHelpAutomationsSection,
} from "@/lib/help-chat-catalog";

const catalogText = formatCatalogForHelpPrompt();

assert.match(catalogText, /אוטומטי × לידים/);
assert.match(catalogText, /אוטומטי × לקוחות/);
assert.match(catalogText, /אוטומטי × צוות/);
assert.match(catalogText, /ידני/);

assert.match(catalogText, /ליד מאתר\/קמפיין/);
assert.match(catalogText, /נרשם אחרי ניסיון/);
assert.match(catalogText, /לא נרשם אחרי ניסיון/);
assert.match(catalogText, /התראה למאמן — שיעור ניסיון/);
assert.match(catalogText, /ביטול שיעור \(למאמן\)/);
assert.match(catalogText, /שליחה לפי סוג מנוי \(לקוחות\)/);
assert.match(catalogText, /דיברו עם זואי ולא נרשמו \(לידים\)/);

assert.doesNotMatch(catalogText, /נוכחות בשיעור ניסיון/);

function catalogMentionsLabel(text: string, labelHe: string): boolean {
  return text.split("\n").some((line) => {
    const idx = line.indexOf("· ");
    if (idx < 0) return false;
    const rest = line.slice(idx + 2);
    return rest === labelHe || rest.startsWith(`${labelHe} (`);
  });
}

for (const entry of TRIGGER_CATALOG) {
  if (entry.implemented) {
    assert.ok(
      catalogMentionsLabel(catalogText, entry.labelHe),
      `live catalog label missing from help prompt: ${entry.type}`
    );
  } else {
    assert.ok(
      !catalogMentionsLabel(catalogText, entry.labelHe),
      `planned catalog label leaked into help prompt: ${entry.type}`
    );
  }
}

assert.match(catalogText, /ליד מאתר\/קמפיין(?! \(דורש Arbox\))/);
assert.match(catalogText, /רכישה \(דורש Arbox\)/);

assert.match(HELP_CHAT_OPT_OUT_HE, /הסר/);
assert.match(HELP_CHAT_OPT_OUT_HE, /Stop promotions/);
assert.match(HELP_CHAT_OPT_OUT_HE, /Utility/);
assert.match(HELP_CHAT_TRIGGERS_WHERE_HE, /אוטומציות/);

const section = formatOwnerHelpAutomationsSection();
assert.ok(section.includes(catalogText));
assert.ok(section.includes(HELP_CHAT_OPT_OUT_HE));
assert.match(section, /Zapier/);

const canned = formatOwnerHelpDeterministicTemplatesReply();
assert.ok(canned.includes(catalogText));
assert.ok(canned.includes(HELP_CHAT_OPT_OUT_HE));
assert.doesNotMatch(canned, /נוכחות בשיעור ניסיון/);

console.log("help-chat-catalog.test.ts: ok");
