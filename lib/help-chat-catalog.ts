import {
  AUDIENCE_LABELS_HE,
  TRIGGER_CATALOG,
  type TriggerActivation,
  type TriggerAudience,
} from "@/lib/trigger-catalog";

const CATALOG_GROUP_ORDER: ReadonlyArray<{
  activation: TriggerActivation;
  audience?: TriggerAudience;
  heading: string;
}> = [
  { activation: "automatic", audience: "leads", heading: "אוטומטי × לידים" },
  { activation: "automatic", audience: "members", heading: "אוטומטי × לקוחות" },
  { activation: "automatic", audience: "staff", heading: "אוטומטי × צוות" },
  { activation: "manual", heading: "ידני" },
];

/** Stable extras — not in TRIGGER_CATALOG. */
export const HELP_CHAT_TRIGGERS_WHERE_HE =
  "טריגרים מוגדרים בטאב «אוטומציות» — אוטומטי או ידני, לפי קהל (לידים / לקוחות / צוות).";

export const HELP_CHAT_OPT_OUT_HE =
  "הסרת שיווק: אם לקוח לחץ «הסר» או Stop promotions בוואטסאפ, לא נשלחות תבניות Marketing. תבניות Utility ותשובות של זואי בשיחה ממשיכות כרגיל.";

/**
 * Live implemented catalog, grouped activation × audience, Hebrew labels.
 * Planned (`implemented: false`) entries are omitted so the help chat stays current.
 */
export function formatCatalogForHelpPrompt(): string {
  const live = TRIGGER_CATALOG.filter((e) => e.implemented).slice();
  const blocks: string[] = [];
  for (const group of CATALOG_GROUP_ORDER) {
    const rows = live
      .filter((e) => {
        if (e.activation !== group.activation) return false;
        if (group.audience && e.audience !== group.audience) return false;
        return true;
      })
      .sort((a, b) => a.uiOrder - b.uiOrder || a.labelHe.localeCompare(b.labelHe, "he"));
    if (rows.length === 0) continue;
    const lines = rows.map((e) => {
      const arbox = e.arboxOnly ? " (דורש Arbox)" : "";
      const audienceNote =
        group.activation === "manual" ? ` (${AUDIENCE_LABELS_HE[e.audience]})` : "";
      return `  · ${e.labelHe}${audienceNote}${arbox}`;
    });
    blocks.push(`${group.heading}:\n${lines.join("\n")}`);
  }
  return blocks.join("\n");
}

/** Full automations section for the owner-help system prompt. */
export function formatOwnerHelpAutomationsSection(): string {
  return `אוטומציות (טאב /templates):
- תבניות וואטסאפ מוכנות מראש — חייבות אישור Meta לפני שליחה מחוץ לחלון 24 שעות.
- יצירת טמפלייט חדש, רענון רשימה ממטא, הגדרת "טמפלייט הפתיחה ללידים".
- אפשר לכבות טמפלייט בצד שלנו (בלי למחוק ממטא).
- חיבור לאוטומציה (Zapier / webhook) — קישור "איך מחברים לאוטומציה?" בתוך הטריגר «ליד מאתר/קמפיין».
- ${HELP_CHAT_TRIGGERS_WHERE_HE}
${formatCatalogForHelpPrompt()}
- ${HELP_CHAT_OPT_OUT_HE}`;
}

/** Canned «where are templates/triggers» reply — same live catalog, no Claude. */
export function formatOwnerHelpDeterministicTemplatesReply(): string {
  return [
    'טמפלייטים וטריגרים מוגדרים בטאב "אוטומציות" בדשבורד. שם יוצרים תבניות וואטסאפ, מגדירים "טמפלייט הפתיחה ללידים", ומוסיפים טריגרים לפי קהל (אוטומטי או ידני). לחיבור לאוטומציה (Zapier וכו\') יש קישור "איך מחברים לאוטומציה?" בתוך הטריגר «ליד מאתר/קמפיין».',
    HELP_CHAT_TRIGGERS_WHERE_HE,
    formatCatalogForHelpPrompt(),
    HELP_CHAT_OPT_OUT_HE,
  ].join("\n");
}
