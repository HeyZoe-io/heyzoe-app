/** הוראות מפורטות לסגנון דיבור — משפיע על פרומפט המערכת */

const VIBE_LINES: Record<string, string> = {
  חברי: "דברי בגובה העיניים, חמים וקרובים; מותר הומור קל וסלנג עדין.",
  מקצועי: "שמרי על לשון עסקית נקייה, מדויקת ובלי סלנג.",
  מצחיק: "אפשר קלילות ושנינות — בלי להגזים או ללעוג ללקוח.",
  רוחני: "טון רגוע, מכבד ומזמין; מילים רכות ומקום לשקט.",
  יוקרתי: "לשון מכובדת, אלגנטית ומינימליסטית — בלי יומרנות.",
  ישיר: "קצר ולעניין, בלי הקדמות ארוכות.",
  אמפתי: "הקשיבי, אמתי והזדהי רגשית בקצרה לפני מענה מעשי.",
  סמכותי: "בטוחות וברורות, עם ידע — בלי להרתיע.",
};

export function buildVibeInstructionLines(
  vibeLabels: string[],
  vibeLinesOverride?: Record<string, string>
): string {
  const map = vibeLinesOverride && Object.keys(vibeLinesOverride).length > 0 ? vibeLinesOverride : VIBE_LINES;
  if (!vibeLabels.length) {
    return "סגנון ברירת מחדל: חם, מקצועי וקצר.";
  }
  return vibeLabels
    .map((v) => map[v] ?? `הדגישי את האווירה: ${v}.`)
    .join("\n");
}
