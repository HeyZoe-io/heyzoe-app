import assert from "node:assert/strict";
import {
  assistantReplySteersBackToStudioScope,
  buildOutOfScopeTeamHandoffReply,
  matchesOutOfScopeTeamHandoff,
  WA_OUT_OF_SCOPE_HANDOFF_REPLY_HE,
} from "@/lib/wa-out-of-scope-handoff";

assert.equal(matchesOutOfScopeTeamHandoff("אני אשלח לך קוח מעודכן"), true);
assert.equal(matchesOutOfScopeTeamHandoff("אשלח לך קבלה מעודכנת"), true);
assert.equal(matchesOutOfScopeTeamHandoff("מחפשים עובדים?"), true);
assert.equal(matchesOutOfScopeTeamHandoff("יש לכם משרה פתוחה"), true);
assert.equal(matchesOutOfScopeTeamHandoff("are you hiring?"), true);
assert.equal(matchesOutOfScopeTeamHandoff("דרוש מזרן לשיעור"), false);

assert.equal(matchesOutOfScopeTeamHandoff("אשמח לפרטים על שיעור ניסיון"), false);
assert.equal(matchesOutOfScopeTeamHandoff("מתי יש אימון ברביעי"), false);
assert.equal(matchesOutOfScopeTeamHandoff("נרשמתי"), false);

assert.equal(
  assistantReplySteersBackToStudioScope(
    "אני פה כדי לעזור בנושאים של האימונים והשירותים שלנו בסטודיו. אם יש לך שאלות על אימוני ניסיון, מנויים, או משהו אחר קשור להתחלה איתנו - אני כאן לעזור 💜"
  ),
  true
);
assert.equal(assistantReplySteersBackToStudioScope("בשיעורי מתחילים לומדים את הבסיס."), false);

assert.equal(buildOutOfScopeTeamHandoffReply("he"), WA_OUT_OF_SCOPE_HANDOFF_REPLY_HE);

console.log("wa-out-of-scope-handoff.test.ts: ok");
