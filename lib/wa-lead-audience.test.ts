import assert from "node:assert/strict";
import {
  applyLeadAgeBandToReply,
  buildAgeBandCatalogReply,
  inferLeadAgeBandFromUserTexts,
  isLeadAgeBandRestatement,
  stripOffAudienceGroupFacts,
} from "@/lib/wa-lead-audience";

const yigalTurns = ["בוקר טוב! אשמח למידע על אימונים למבוגרים", "יש קרב מגע קבוצתי?"];
assert.equal(inferLeadAgeBandFromUserTexts(yigalTurns), "adults");
assert.equal(inferLeadAgeBandFromUserTexts([...yigalTurns, "למבוגרים"]), "adults");
assert.equal(inferLeadAgeBandFromUserTexts(["נוער גילאי 9-12"]), "youth");
assert.equal(inferLeadAgeBandFromUserTexts(["ילדים גילאי 6-8"]), "kids");
assert.equal(inferLeadAgeBandFromUserTexts(["לא ילדים, למבוגרים"]), "adults");
assert.equal(inferLeadAgeBandFromUserTexts(["בוקר טוב"]), null);
assert.equal(inferLeadAgeBandFromUserTexts(["אימונים למבוגרים", "ומה עם הילדים?"]), "kids");

assert.equal(isLeadAgeBandRestatement("למבוגרים"), true);
assert.equal(isLeadAgeBandRestatement("בוגרים"), true);
assert.equal(isLeadAgeBandRestatement("יש קרב מגע קבוצתי?"), false);

const mixed =
  "כן! יש לנו אימון קבוצתי משולב - קרב מגע והגנה עצמית במסגרת קבוצתית לנשים וגברים, עם התאמה לרמת המתאמנת. האימונים מתקיימים ימי ראשון ורביעי: ב-16:45 לילדים (גילאי 6-8) ב-17:30 לנוער (גילאי 9-12) ברצונך לנסות שיעור ניסיון?";

const stripped = stripOffAudienceGroupFacts(mixed, "adults");
assert.match(stripped, /אימון קבוצתי משולב/);
assert.match(stripped, /ברצונך לנסות שיעור ניסיון/);
assert.doesNotMatch(stripped, /ילדים|נוער|16:45|17:30|גילאי/);
assert.equal(stripOffAudienceGroupFacts(mixed, null), mixed);

const kidsOnly =
  "ימי ראשון ורביעי ב16:45 האימונים לילדים בגילאי 6-8. ימי ראשון ורביעי ב17:30 האימונים לנוער בגילאי 9-12.";
const catalog = {
  knowledgeCatalogServices: [
    { name: "קרב מגע לילדים" },
    { name: "קרב מגע לנוער" },
    { name: "תהליך ירידה במשקל" },
    { name: "אימון אישי" },
    { name: "אימון זוגי" },
  ],
};
assert.equal(
  applyLeadAgeBandToReply(kidsOnly, "adults", catalog),
  "למבוגרים יש אצלנו תהליך ירידה במשקל, אימון אישי ואימון זוגי."
);
assert.equal(
  buildAgeBandCatalogReply(catalog, "kids"),
  "לילדים יש אצלנו קרב מגע לילדים."
);
assert.equal(buildAgeBandCatalogReply(catalog, "youth"), "לנוער יש אצלנו קרב מגע לנוער.");

const kept = applyLeadAgeBandToReply(mixed, "adults", catalog);
assert.match(kept, /אימון קבוצתי משולב/);
assert.doesNotMatch(kept, /ילדים|נוער/);
