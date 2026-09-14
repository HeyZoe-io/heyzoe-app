import assert from "node:assert/strict";
import {
  isFreezeActionRequest,
  hasBusinessFreezeActionKnowledge,
  FREEZE_ACTION_HANDOFF_REPLY,
} from "@/lib/wa-freeze-action-handoff";

// שיחת ליד אמיתית: המנוי בהקפאה, רוצה לבטל את ההקפאה ולהירשם
assert.equal(
  isFreezeActionRequest(
    "בוקר טוב המנוי שלי בהקפאה עד היום רציתי לברר אם ניתן לבטל את ההקפאה ולרשום אותי לאימון של היום ב17:30 עם אלה?"
  ),
  true
);
assert.equal(
  isFreezeActionRequest("אני רוצה להרשם לא לבטל רישום ואני לא יכול כי המנוי שלי בהקפאה"),
  true
);
assert.equal(isFreezeActionRequest("יש לי מנוי הוא בהקפאה"), true);
assert.equal(isFreezeActionRequest("אפשר להסיר את ההקפאה?"), true);

// שאלות מדיניות כלליות - לא בקשת פעולה על הקפאה קיימת
assert.equal(isFreezeActionRequest("אפשר להקפיא את המנוי?"), false);
assert.equal(isFreezeActionRequest("מה מדיניות ההקפאה?"), false);
assert.equal(isFreezeActionRequest("כמה זמן אפשר להקפיא?"), false);
assert.equal(isFreezeActionRequest("מתי השיעור?"), false);

// ידע עסקי ספציפי לטיפול בהקפאה
assert.equal(hasBusinessFreezeActionKnowledge(undefined), false);
assert.equal(hasBusinessFreezeActionKnowledge([]), false);
assert.equal(
  hasBusinessFreezeActionKnowledge([
    { question: "כמה זמן אפשר להקפיא?", answer: "ניתן להקפיא עד 14 יום על כל חצי שנה" },
  ]),
  false
);
assert.equal(
  hasBusinessFreezeActionKnowledge([
    { question: "איך מבטלים הקפאה קיימת?", answer: "אפשר לבטל את ההקפאה ישירות באפליקציה בכל עת" },
  ]),
  true
);

assert.match(FREEZE_ACTION_HANDOFF_REPLY, /מעבירה לצוות שיצרו איתך קשר/);

console.log("wa-freeze-action-handoff.test.ts: ok");
