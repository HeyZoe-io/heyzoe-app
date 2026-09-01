import type { BusinessKnowledgePack } from "@/lib/business-context";
import { knowledgeQaTextBlob } from "@/lib/knowledge-qa";
import { sanitizeZoeOutboundLanguage } from "@/lib/zoe-text";
import {
  formatCourseCyclesForKnowledge,
  formatScheduleSlotsForKnowledge,
  HEBREW_DAY_OPTIONS,
  type CourseCycle,
  type ProductScheduleSlot,
} from "@/lib/product-schedule-slots";
import {
  ensureScheduleWhenConvenientQuestion,
  stripPrematureAfterRegistration,
} from "@/lib/wa-outbound-registration-guard";

export type WaReplyAddressingMode = "neutral" | "feminine" | "plural";

export type ApplyAssistantReplyFixesInput = {
  knowledge: BusinessKnowledgePack | null;
  phase?: string;
  /** multi-service ועדיין אין sf_service — אל תזמין לבחירת אימון בתשובה */
  multiServiceAwaitingPick?: boolean;
  /** schedule_date/time + כבר נבחר אימון — ניסוח מועדים */
  scheduleSlotsWithPickedService?: boolean;
  selectedServiceName?: string;
  /** שמות יום מהלוח (רביעי…) — לתיקון מיזוגים כמו «בחרוביעי» */
  scheduleDayLabels?: string[];
  /** true אחרי הרשמה אמיתית — לא לחתוך תבנית אחרי-הרשמה */
  trialRegistered?: boolean;
};

export function getScheduleDayLabelsFromSlots(slots: { day: string }[]): string[] {
  const labels = new Set<string>();
  for (const slot of slots) {
    const letter = String(slot.day ?? "").trim();
    const opt = HEBREW_DAY_OPTIONS.find((o) => o.value === letter);
    if (opt?.label) labels.add(opt.label);
  }
  return [...labels];
}

/** מועדים מדויקים לאימון שנבחר — לפרומפט Claude (לא לשליחה ללקוח). */
export function buildPickedServiceScheduleLexiconForPrompt(input: {
  serviceName: string;
  scheduleSlots?: { day: string; time: string }[];
  courseCycles?: CourseCycle[];
}): string {
  const name = String(input.serviceName ?? "").trim();
  if (!name) return "";
  const cycles = input.courseCycles ?? [];
  if (cycles.length > 0) {
    const cyclesTxt = formatCourseCyclesForKnowledge(cycles);
    if (cyclesTxt) {
      return `מחזורי קורס ל«${name}» (ניסוח מהמערכת — אל תשני ימים/שעות/תאריכים): ${cyclesTxt}`;
    }
  }
  const slots = input.scheduleSlots ?? [];
  if (slots.length === 0) return "";
  const rows: ProductScheduleSlot[] = slots.map((s, i) => ({
    id: String(i),
    day: s.day,
    time: s.time,
  }));
  const formatted = formatScheduleSlotsForKnowledge(rows);
  if (!formatted) return "";
  return `מועדי לוח ל«${name}» (ניסוח מהמערכת — שמות ימים כמו «יום רביעי», לא «בחרוביעי»): ${formatted}`;
}

const SERVICE_PICK_INVITATION_LINE =
  /(?:אתה|את)\s+בחופשיות\s+לבחור|בחר(?:י|ו)?\s+(?:מ)?(?:אימון|שיעור)|איזה\s+אימון\s+(?:הכי\s+)?(?:קורץ|מעניין)|תוכל(?:י)?\s+לבחור\s+(?:מ)?(?:אימון|שיעור)|אוכל(?:י|ת)?\s+לבחור\s+(?:מ)?(?:אימון|שיעור)|יש\s+לך\s+\d*\s*אימונים|יש\s+לך\s+(?:שתי|שלוש|כמה)\s+אפשרויות/iu;

const WRONG_SCHEDULE_SLOTS_INTEREST =
  /אם\s+(?:את|אתה)\s+[^.\n!?]{0,140}?(?:תוכל|אוכל|תוכלי|אוכלי|תוכלו|אוכלו)[^.\n!?]{0,60}?(?:זמנים|מועדים|מהזמנים)[^.!?]*[.!?]?/giu;

const WOMEN_ONLY_AUDIENCE_RE =
  /לנשים\s+בלבד|נשים\s+בלבד|סטודיו.{0,50}לנשים|בוטיק\s+לנשים|מותאם\s+לנשים|אימונים?\s+לנשים(?!\s+ו)|שיעורים?\s+לנשים(?!\s+ו)|לנשים\s+במיוחד/iu;

/** קהל נשים מפורש בדשבורד / תיאור עסק — מותר פנייה נקבה. */
export function businessKnowledgeIndicatesWomenOnlyAudience(
  knowledge: BusinessKnowledgePack | null
): boolean {
  if (!knowledge) return false;
  if (knowledge.genderText?.trim() === "נקבה") return true;
  const blob = [
    knowledge.businessDescription,
    knowledge.targetAudienceText,
    ...(knowledge.traits ?? []),
    knowledgeQaTextBlob(knowledge.knowledgeQa),
    knowledge.servicesText,
  ]
    .filter(Boolean)
    .join("\n");
  return WOMEN_ONLY_AUDIENCE_RE.test(blob);
}

export function resolveWaReplyAddressingMode(knowledge: BusinessKnowledgePack | null): WaReplyAddressingMode {
  if (businessKnowledgeIndicatesWomenOnlyAudience(knowledge)) return "feminine";
  return "neutral";
}

/** ניסוח מועדים אחרי שכבר נבחר אימון (תפריט/שאלת זמנים נשלחים בנפרד). */
export function buildScheduleSlotsInterestPhrase(
  serviceName: string,
  mode: WaReplyAddressingMode
): string {
  const svc = String(serviceName ?? "").trim() || "האימון";
  if (mode === "feminine") {
    return `אם מצאת עניין ב${svc}, אפשר לבחור בכל אחד מהזמנים האלה`;
  }
  if (mode === "plural") {
    return `אם מצאתם עניין ב${svc}, אפשר לבחור בכל אחד מהזמנים האלה`;
  }
  return `אם יש עניין ב${svc}, אפשר לבחור בכל אחד מהזמנים האלה`;
}

const SERVICE_LEXICON_SKIP = new Set([
  "שיעור",
  "שיעורי",
  "שיעורים",
  "יוגה",
  "אימון",
  "אימוני",
  "אימונים",
  "קורס",
  "סדנה",
  "ניסיון",
  "לכל",
  "הרמות",
  "נשים",
  "מתחיל",
  "מפגשים",
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectServiceLexiconTokens(serviceNames: string[]): string[] {
  const tokens = new Set<string>();
  for (const raw of serviceNames) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    tokens.add(name);
    for (const word of name.match(/[\u0590-\u05FF]{4,}/gu) ?? []) {
      if (!SERVICE_LEXICON_SKIP.has(word)) tokens.add(word);
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

function collectServiceNamesFromKnowledge(knowledge: BusinessKnowledgePack | null): string[] {
  if (!knowledge) return [];
  const names = new Set<string>();
  for (const n of knowledge.serviceNamesForOpening ?? []) {
    const t = String(n ?? "").trim();
    if (t) names.add(t);
  }
  for (const row of knowledge.salesFlowServices ?? []) {
    const t = String(row.name ?? "").trim();
    if (t) names.add(t);
  }
  return [...names];
}

/** תיקון שגיאות כתיב נפוצות בשמות שירות מהדשבורד (ח/ק, «ל» מיותר). */
function applyServiceLexiconFixes(text: string, serviceNames: string[]): string {
  const tokens = collectServiceLexiconTokens(serviceNames);
  if (!tokens.length) return text;
  let s = String(text ?? "");
  for (const canonical of tokens) {
    const typos = new Set<string>();
    if (canonical.includes("ח")) typos.add(canonical.replace(/ח/g, "ק"));
    if (canonical.includes("ק")) typos.add(canonical.replace(/ק/g, "ח"));
    if (canonical.includes("כ")) typos.add(canonical.replace(/כ/g, "ק"));
    if (canonical.includes("ק")) typos.add(canonical.replace(/ק/g, "כ"));
    if (/^מ[\u0590-\u05FF]+(?:ים|ות)$/u.test(canonical)) {
      typos.add(`ל${canonical}`);
    }
    for (const typo of typos) {
      if (typo === canonical) continue;
      s = s.replace(new RegExp(`(?<![\u0590-\u05FF])${escapeRegExp(typo)}(?![\u0590-\u05FF])`, "gu"), canonical);
    }
  }
  return s;
}

/**
 * ליד במגדר לא ידוע — ברירת מחדל זכר רבים («אתם», «לכם»), לא נקבה רבים («אתן», «לאתן»).
 * זואי בגוף נקבה («שמחה») נשארת ללא שינוי.
 */
export function fixNeutralLeadPluralAddressing(text: string): string {
  let s = String(text ?? "");
  const pairs: Array<[RegExp, string]> = [
    [/\bבואו\s+נמצא\s+לאתן\b/giu, "בואו נמצא לכם"],
    [/\bנמצא\s+לאתן\b/giu, "נמצא לכם"],
    [/\bמצא\s+לאתן\b/giu, "מצא לכם"],
    [/\bשאתן\b/giu, "שאתם"],
    [/\bלאתן\b/giu, "לכם"],
    [/\bאתן\s+כאן\b/giu, "אתם כאן"],
    [/\bאתן\s+מוזמנות\b/giu, "אתם מוזמנים"],
    [/\bאתן\s+יכולות\b/giu, "אתם יכולים"],
    [/(?<![\u0590-\u05FF])שאתם\s+מכירות(?![\u0590-\u05FF])/giu, "שאתם מכירים"],
    [/(?<![\u0590-\u05FF])אתם\s+מכירות(?![\u0590-\u05FF])/giu, "אתם מכירים"],
    [/\bאתן\s+הגעתן\b/giu, "אתם הגעתם"],
    [/\bעבור\s+אתן\b/giu, "עבור אתם"],
    [/\bשלכן\b/giu, "שלכם"],
  ];
  for (const [re, repl] of pairs) {
    s = s.replace(re, repl);
  }
  return s;
}

const HEB_BOUND = String.raw`(?<![\u0590-\u05FF])`;
const HEB_END = String.raw`(?![\u0590-\u05FF])`;

/**
 * מגדר לא ידוע: «אתה/את רוצה» → «ברצונך»; הוראות אפליקציה ברבים סתמיים.
 * «אתה רוצה» מתוקן גם בקהל נשים — פנייה זכר אף פעם לא נכונה שם.
 */
export function fixNeutralGenderedWantAndHowTo(
  text: string,
  mode: WaReplyAddressingMode = "neutral"
): string {
  let s = String(text ?? "");
  s = s.replace(/או\s+שאתה\s+רוצה\s+עזרה/gu, "או שצריך עזרה");
  s = s.replace(/אם\s+אתה\s+רוצה/gu, "אם ברצונך");
  s = s.replace(new RegExp(`${HEB_BOUND}אתה\\s+רוצה${HEB_END}`, "gu"), "ברצונך");
  s = s.replace(
    /נכנס,?\s*(?:ביטל|מבטל)\s+את\s+ההרשמה\s+ונרשם/gu,
    "נכנסים, מבטלים את ההרשמה ונרשמים"
  );
  if (mode === "feminine") return s;

  s = s.replace(/או\s+שאת\s+רוצה\s+עזרה/gu, "או שצריך עזרה");
  s = s.replace(/שאת\s+רוצה\s+עזרה/gu, "שצריך עזרה");
  s = s.replace(/אם\s+את\s+רוצה/gu, "אם ברצונך");
  s = s.replace(new RegExp(`${HEB_BOUND}את\\s+רוצה${HEB_END}`, "gu"), "ברצונך");
  s = s.replace(
    /נכנסת,?\s*(?:בוטלת|מבטלת)\s+את\s+ההרשמה\s+ונרשמת/gu,
    "נכנסים, מבטלים את ההרשמה ונרשמים"
  );
  return s;
}

/** סיום ארוך כשהמיקום לא מתאים → ניסוח קבוע. */
function applyLocationFarClosingFix(text: string): string {
  let s = String(text ?? "");
  const canonicalClosing = "אין בעיה בכלל! אם משהו ישתנה בעתיד, אנחנו כאן 🙂";
  s = s.replace(
    /אם בא לך ללמוד עוד על זה או אם משהו משתנה בעתיד\s*[-–—]?\s*את(?:ם|הן)?\s+מוזמנ(?:ים|ות)?\s+בחזרה\.?\s*(?:מצליחה|בהצלחה)\s+בחיפוש\s+הסטודיו\s+המתאים!\s*🙂?/giu,
    canonicalClosing
  );
  s = s.replace(
    /אם בא לך ללמוד עוד על זה או אם משהו משתנה בעתיד[^.!?\n]*[.!?]?\s*(?:מצליחה|בהצלחה)\s+בחיפוש\s+הסטודיו\s+המתאים!\s*🙂?/giu,
    canonicalClosing
  );
  s = s.replace(/אם משהו ישתנה בעתיד, אנחנו כאן\s*:\)/giu, canonicalClosing);
  return s;
}

function stripServicePickInvitationLines(text: string): string {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    return !SERVICE_PICK_INVITATION_LINE.test(t);
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fixWrongScheduleSlotsInterest(text: string, serviceName: string, mode: WaReplyAddressingMode): string {
  const canonical = buildScheduleSlotsInterestPhrase(serviceName, mode);
  return String(text ?? "").replace(WRONG_SCHEDULE_SLOTS_INTEREST, canonical);
}

/** תיקון מיזוגי אותיות נפוצים סביב ימים שמופיעים במועדים הפעילים. */
function applyScheduleDayGarbleFixes(text: string, activeDayLabels: string[]): string {
  if (!activeDayLabels.length) return text;
  let s = String(text ?? "");
  for (const day of activeDayLabels) {
    const d = day.trim();
    if (!d) continue;
    s = s.replace(new RegExp(`בחרו\\s*${d}`, "giu"), `ביום ${d}`);
    s = s.replace(new RegExp(`ביום\\s*${d}`, "giu"), `ביום ${d}`);
    s = s.replace(new RegExp(`יום\\s*${d}`, "giu"), `יום ${d}`);
  }
  return s;
}

/** כללים לפרומפט Claude — שאלות פתוחות ב-split. */
export function buildWaSpellingAndPhrasingPromptRule(
  knowledge: BusinessKnowledgePack | null,
  waCtx?: {
    suppressFollowUpQuestion?: boolean;
    scheduleInterestServiceName?: string;
    pickedServiceScheduleLexicon?: string;
  }
): string {
  if (!waCtx?.suppressFollowUpQuestion) return "";
  const mode = resolveWaReplyAddressingMode(knowledge);
  const scheduleExample = waCtx.scheduleInterestServiceName?.trim()
    ? buildScheduleSlotsInterestPhrase(waCtx.scheduleInterestServiceName.trim(), mode)
    : "";
  const lexicon = waCtx.pickedServiceScheduleLexicon?.trim() ?? "";
  const addressingHint =
    mode === "feminine"
      ? "מותר «מצאת עניין» (קהל נשים מפורש בידע)."
      : "ניטרלי: «ברצונך» לכל משפט של רצון, לא רק לחידוש ולא רק לביטול («אם ברצונך להגיע / לנסות / לקבוע / לשמוע עוד»). גוונ גם שם פועל («ולקבל», «לקבלת אישור»), סתמי («אפשר», «ניתן», «יש ל…»), «באפשרותך»/«ביכולתך», או «נחדש לך». לא «אתה רוצה», לא «את רוצה», לא «אתה יכול», לא «ואז תקבל»/«מחר תקבל», לא «שלח בקשה», לא «את מעניינת», לא «תוכלי/אוכלת לבחור». לך/שלך/אותך מותר. פנייה לליד במרובה: «אתם», «לכם», «שאתם מכירים» — לא «אתן», «לאתן», «שאתן», לא «שאתם מכירות». הוראות אפליקציה/ביטול: «נכנסים, מבטלים, נרשמים» — לא «נכנסת, בוטלת, נרשמת». «או שצריך עזרה» — לא «שאת רוצה עזרה».";

  return `
איות וניסוח (חובה לפני סיום התשובה):
- לקסיקון מהדשבורד: שמות אימונים, מחירים, FAQ ומועדים - מהשדות «ידע עסקי» ומהשורות למטה; העתיקי שמות שירות בדיוק (אות-באות) — פרפרזה רק לגוון, בלי לשנות אותיות, בלי לקצר (למשל «ממשיכים» עם כ לא «ממשיקים» עם ק), ובלי לשנות ימי שבוע (רביעי, שלישי…) או שעות. בפרגון: אותה מילה מהשירות/מהשיחה. עיסוי זה לא ספא — אסור «תהני בספא» אם דיברתן על עיסוי או טיפול.
- עברית בלבד — כתב עברי בלבד; אסור אותיות בערבית (למשל «כל» לא «كل»).
- איות: «אימון» לא «אימן»; «לומדים» לא «למדים»; «אין לי» לא «לא יש לי»; «בהצלחה» לא «מצליחה»; «החלמה מהירה» לא «בהחלמה מהירה»; «בדיוק» לא «לבדיוק»; «לוודא» לא «ליוודע»; «יכולה» לא «יוכלה»; «מתאים לך» לא «מתוקף לך»; «רצפת האגן» לא «הרצפה האגן»; «להגיד לה» לא «להגידה לה».
- הטיית עתיד: אסור «כשתהיי רוצה» / «תהיי רוצה» — נכון «תרצי» / «כשתרצי» (נקבה) או «ברצונך» (ניטרלי). אל תבני «תהיי» + בינוני של פועל. ניסוחי זואי: «אנחנו כאן כשתרצי», «תרצי - כתבי לי».
- דיוק במילים: לפני סיום, ודאי שכל מילה אומרת בדיוק את מה שהתכוונת. מילים שדומות באות אחת אך שונות במשמעות («מתוקה»/«מצוקה», «קשה»/«קושי», «מנוי»/«מנוע») - קל להחליף ביניהן. קראי את המשפט שוב וודאי שהוא הגיוני בהקשר של השיחה.
- מקף: רק מקף רגיל (-). אסור מקף ארוך (—) או מקף בינוני (–).
- כשמסבירים על התמחות/סוג השירות: קצר ועובדתי, למשל «ההתמחות שלנו היא ביוגה». אסור «גופים» ברבים ואסור ניסוחים כמו «לכל סוגי הגופים» / «לכל סוגי גופים ודרישות» - זה לא תקני בעברית. אם רוצים להרחיב: «לכל הרמות» או «מתאים לכל אחת ואחד».
- אל תסיקי לבד שהליד לא רלוונטי. כשהליד אמר במפורש שזה לא מתאים (רחוק מדי / לא מחפש / לא מעוניין) - סיימי רק במשפט הבא בדיוק: «אין בעיה בכלל! אם משהו ישתנה בעתיד, אנחנו כאן 🙂» — בלי שאלה, בלי הנעה לפעולה, בלי «בהצלחה בחיפוש» / «מוזמנים בחזרה». שאלה על שירות שלא קיים אצלנו (למשל פילאטיס בסטודיו יוגה) אינה «לא רלוונטי» - עני עובדתית מה כן יש, בלי משפט הסיום הזה. אם הליד אומר שזה כן רלוונטי או ממשיך שיחה רגילה - אסור משפט הסיום הזה.
- ${addressingHint}
- אל תזמיני לבחירת אימון/שיעור ואל תפרטי רשימת אימונים — המערכת שולחת תפריט/שאלה בנפרד מיד אחרייך.
- בלי להתפלסף: תשובות קצרות ולעניין. אם הליד לא מרגיש טוב - רק «מצטערת לשמוע, מאחלת החלמה מהירה!» (אסור «אני מבינה שזה מתסכל» / «קשה לעמוד בצד» / «ההשקעה הטובה ביותר»). עובדה מהידע: ישר «ניתן להקפיא…» בלי «הטוב שיש לנו מדיניות גמישה». בלבול בהקפאה/חיוב על מנוי קיים: משפט אמפתיה קצר והעברה לצוות — אסור «זה בדיוק משהו שצריך להתברר», אסור «חשוב שכל דבר יהיה על פי מה שביקשת». נכון: «זה משהו שצריך לברר מול הצוות». אם הליד מבקש מועד שכבר נקבע / ליומן ולא ברור אם מנוי או ניסיון — שאלי רק «היי! 👋 יש לך מנוי קיים אצלנו או שמדובר באימון ניסיון?». אם מנוי קיים: מעבירה לצוות, לא שולחת להתקשר לבד.
- אם הליד משתף כוונה/עדכון בלי שאלה («אנסה להגיע בסופ״ש») - אישור קצר וחם בלבד. אסור שיעורי חיים («אל תתנגדי לעצמך») ואסור «בואי תרשמי» - המערכת שולחת CTA בנפרד.
- אחרי תודה / «חושבת על זה» / שיתוף שקשה עכשיו: אמפתיה קצרה בלבד. אסור «נשמח לראותך ביום X בשעה Y» אלא אם הליד ממש נרשם למועד הזה בשיחה. הצעת מאמן בהיסטוריה אינה הרשמה.
- איחור / בדרך לשיעור: רק «בסדר גמור אנחנו כאן.» אסור «בטוח שזה יעבוד», אסור «קח את הזמן».
${lexicon ? `- מועדים לאימון שכבר נבחר — העתיקי בדיוק מהשורה: «${lexicon}». לציון מועד בודד: «ביום {יום} בשעה {שעה}» עם שם היום כמו בלקסיקון.` : ""}
${scheduleExample ? `- אם מוזכרים מועדים/זמנים אחרי שכבר נבחר אימון — ניסוח כמו: «${scheduleExample}» (לא «את מעניינת ב… תוכלי לבחור מהזמנים»).` : ""}`;
}

/**
 * High-precision leak of HeyZoe *owner* UI / bot on-off instructions.
 * Intentionally does NOT match customer-facing terms: מערכת שעות, לוח שיעורים,
 * דשבורד (CRM/אפליקציה של העסק), מסלול מכירה, בוטיק, או השם זואי כנציגה.
 * Hebrew `\b` is unreliable — require end/punctuation after «בוט» so «בוטיק» is kept.
 */
const BOT_WORD_END = String.raw`(?:ה)?בוט(?:ים)?(?=$|[\s.,!?…:;])`;
const CUSTOMER_PLATFORM_LEAK_RE = new RegExp(
  [
    String.raw`heyzoe`,
    String.raw`דף\s*השיחות`,
    String.raw`כיבוי(?:ים)?\s+(?:של\s+)?${BOT_WORD_END}`,
    String.raw`לכבות\s+(?:את\s+)?${BOT_WORD_END}`,
    String.raw`כיבוי\s+זואי(?=$|[\s.,!?…:;])`,
    String.raw`עצור\s+${BOT_WORD_END}`,
    String.raw`הגדרות\s+(?:של\s+)?${BOT_WORD_END}`,
    String.raw`ניהול\s+${BOT_WORD_END}`,
  ].join("|"),
  "iu"
);

const CUSTOMER_PLATFORM_LEAK_FALLBACK =
  "אני כאן כדי לעזור לגבי השירותים שלנו. במה אפשר לעזור?";

export function looksLikeCustomerFacingPlatformLeak(text: string): boolean {
  CUSTOMER_PLATFORM_LEAK_RE.lastIndex = 0;
  return CUSTOMER_PLATFORM_LEAK_RE.test(String(text ?? ""));
}

function stripPlatformLeakChunks(text: string): string {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const keptLines: string[] = [];
  for (const line of lines) {
    const chunks = line.split(/(?<=[.!?])\s+/u).filter((p) => p.trim());
    const kept = chunks.filter((chunk) => !looksLikeCustomerFacingPlatformLeak(chunk));
    if (kept.length) keptLines.push(kept.join(" ").trim());
  }
  return keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isUsableCustomerReplyAfterLeakStrip(text: string): boolean {
  const compact = String(text ?? "")
    .replace(/[\s\p{Emoji_Presentation}\p{Extended_Pictographic}!.,?\-–—*]+/gu, "")
    .trim();
  if (compact.length < 18) return false;
  if (/^(הבנתי|אוקיי|אוקסי|סבבה|תודה|נכון|אתהצודק|אתצודקת)+$/iu.test(compact)) return false;
  return true;
}

function scrubCustomerFacingPlatformLeak(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw || !looksLikeCustomerFacingPlatformLeak(raw)) return raw;
  const stripped = stripPlatformLeakChunks(raw);
  if (stripped && isUsableCustomerReplyAfterLeakStrip(stripped)) {
    console.error("[zoe] stripped customer-facing platform leak; kept remaining reply", {
      preview: raw.slice(0, 180),
    });
    return stripped;
  }
  console.error("[zoe] blocked customer-facing platform leak", {
    preview: raw.slice(0, 180),
  });
  return CUSTOMER_PLATFORM_LEAK_FALLBACK;
}

const ILLNESS_GET_WELL = "מצטערת לשמוע, מאחלת החלמה מהירה!";

const ILLNESS_CONTEXT_RE = /החלמה|לעמוד\s+בצד/u;
const ILLNESS_PHILOSOPHY_RE =
  /אני\s+מבינ[הא]\s+שזה\s+מתסכל|קשה\s+לעמוד\s+בצד|החלמה\s+טובה\s+היא\s+ההשקעה|ההשקעה\s+הטובה\s+ביותר/iu;

/** פילוסופיית החלמה → משפט אחד קצר. */
function applyIllnessPhilosophyFix(text: string): string {
  let s = String(text ?? "");
  if (!ILLNESS_CONTEXT_RE.test(s) || !ILLNESS_PHILOSOPHY_RE.test(s)) return s;
  s = s
    .replace(/אני\s+מבינ[הא]\s+שזה\s+מתסכל,?\s*/giu, "")
    .replace(/בטח\s+קשה\s+לעמוד\s+בצד[.!]?\s*/giu, "")
    .replace(/קשה\s+לעמוד\s+בצד[.!]?\s*/giu, "")
    .replace(/אבל\s+החלמה\s+טובה\s+היא\s+ההשקעה[^.!?\n]*[.!]?\s*/giu, "")
    .replace(/החלמה\s+טובה\s+היא\s+ההשקעה[^.!?\n]*[.!]?\s*/giu, "")
    .replace(/ההשקעה\s+הטובה\s+ביותר[^.!?\n]*[.!]?\s*/giu, "")
    .replace(/^\s*אבל\s+/giu, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
  if (!s) return ILLNESS_GET_WELL;
  if (/מאחלת\s+החלמה/u.test(s)) return s;
  return `${ILLNESS_GET_WELL} ${s}`.trim();
}

/**
 * «נשמח לראותך ביום X בשעה Y» בלי הרשמה — Claude ממציא מועד מהיסטוריה (הצעת מאמן וכו׳).
 * אחרי הרשמה אמיתית (`trialRegistered`) לא חותכים.
 */
const HE_SEE_YOU_DAY =
  String.raw`(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|חומש)|היום|מחרתיים|מחר`;
const HE_SEE_YOU_HOUR =
  String.raw`(?:\d{1,2}(?::\d{2})?|אחת[\s-]?עשרה|שתים[\s-]?עשרה|שתיים[\s-]?עשרה|אחת|שתיים|שתים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע|עשר)`;
const FABRICATED_SEE_YOU_AT_SLOT_RE = new RegExp(
  String.raw`(?:נשמח\s+לראות(?:ך|כם)|נתראה|מחכ(?:ה|ים|ות)\s+ל(?:ך|כם))\s+ב?(?:${HE_SEE_YOU_DAY})\s+(?:בשעה\s+|ב-?)${HE_SEE_YOU_HOUR}\s*[!.]?`,
  "giu"
);
const FABRICATED_SEE_YOU_FALLBACK = "בכל עת שתצטרכי - אני כאן 💜";

export function stripFabricatedSeeYouAtSlot(text: string): string {
  let s = String(text ?? "").trim();
  if (!s) return s;
  FABRICATED_SEE_YOU_AT_SLOT_RE.lastIndex = 0;
  if (!FABRICATED_SEE_YOU_AT_SLOT_RE.test(s)) return s;
  FABRICATED_SEE_YOU_AT_SLOT_RE.lastIndex = 0;
  s = s.replace(FABRICATED_SEE_YOU_AT_SLOT_RE, "").trim();
  s = s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/([.,!]){2,}/g, "$1")
    .replace(/^\s*[-–—.]\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || FABRICATED_SEE_YOU_FALLBACK;
}

/** שיעור-חיים / דחיפה להרשמה אחרי «אנסה להגיע» — לא תבנית; Claude ממציא. */
const COACHING_SELF_RE =
  /אל\s+תתנגד(?:י|ו)?\s+לעצמ(?:ך|כם)|אל\s+תוות(?:ר|רי|רו)\s+על\s+עצמ(?:ך|כם)|תסמכ(?:י|ו)?\s+על\s+עצמ(?:ך|כם)|זה\s+הזמן\s+להשקיע\s+בעצמ(?:ך|כם)/iu;
const UNSOLICITED_REGISTER_PUSH_RE =
  /בואי\s+תרשמ(?:י)?|בואו\s+תרשמ(?:ו)?|יאללה\s+תרשמ(?:י|ו)/iu;

const CHEERLEADING_RE =
  /בטוח\s+שזה\s+יעבוד|קח(?:י|ו)?\s+את\s+הזמן(?:\s+שצריך|\s+שלך)?|נראה\s+אותך\s+בעוד|עד\s+עכשיו!?/iu;

export function stripCoachingAndUnsolicitedRegisterPush(text: string): string {
  let s = String(text ?? "").trim();
  if (!s) return s;
  if (!COACHING_SELF_RE.test(s) && !UNSOLICITED_REGISTER_PUSH_RE.test(s) && !CHEERLEADING_RE.test(s)) {
    return s;
  }
  const before = s;
  s = s.replace(/אל\s+תתנגד(?:י|ו)?\s+לעצמ(?:ך|כם)\s*[-–—,:]?\s*/giu, "");
  s = s.replace(/אל\s+תוות(?:ר|רי|רו)\s+על\s+עצמ(?:ך|כם)\s*[-–—,:]?\s*/giu, "");
  s = s.replace(/תסמכ(?:י|ו)?\s+על\s+עצמ(?:ך|כם)\s*[-–—,.]?\s*/giu, "");
  s = s.replace(/זה\s+הזמן\s+להשקיע\s+בעצמ(?:ך|כם)\s*[-–—,.]?\s*/giu, "");
  s = s.replace(/(?:יאללה\s*,?\s*)?בואי\s+תרשמ(?:י)?[^.!?\n]*/giu, "");
  s = s.replace(/(?:יאללה\s*,?\s*)?בואו\s+תרשמ(?:ו)?[^.!?\n]*/giu, "");
  s = s.replace(/בטוח\s+שזה\s+יעבוד[^.!?\n]*/giu, "");
  s = s.replace(/קח(?:י|ו)?\s+את\s+הזמן(?:\s+שצריך|\s+שלך)?[^.!?\n]*/giu, "");
  s = s.replace(/נראה\s+אותך\s+בעוד[^.!?\n]*/giu, "");
  s = s.replace(/עד\s+עכשיו!?/giu, "");
  s = s.replace(/[-–—:]\s*$/gu, "");
  s = s.replace(/[.,]\s*[.,]/g, ".");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  return s || before;
}

function stripPolicyFluffPreamble(text: string): string {
  let s = String(text ?? "");
  s = s.replace(/לגבי\s+החיובים\s*[-–—:]\s*/giu, "");
  s = s.replace(/הטוב\s+שיש\s+לנו\s+מדיניות\s+גמישה[.!]?\s*/giu, "");
  s = s.replace(/הטוב\s+הוא\s+שיש\s+לנו\s+מדיניות\s+גמישה[.!]?\s*/giu, "");
  s = s.replace(/יש\s+לנו\s+מדיניות\s+גמישה[.!]?\s*(?=ניתן\s+להקפיא)/giu, "");
  return s.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

function stripFakeScheduleImagePlaceholders(text: string): string {
  let s = String(text ?? "");
  s = s.replace(/מערכת השעות:\s*\[[^\]]{0,80}\]/giu, "");
  s = s.replace(/\[[^\]]{0,80}תישלח[^\]]{0,40}\]/giu, "");
  s = s.replace(/תמונה של לוח השיעורים תישלח כאן/giu, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** post-process על תשובת split לפני שליחה ל-WhatsApp (אפס API). */
export function applyKnownAssistantReplyFixes(
  text: string,
  input: ApplyAssistantReplyFixesInput
): string {
  const serviceNames = collectServiceNamesFromKnowledge(input.knowledge);
  let s = sanitizeZoeOutboundLanguage(String(text ?? "").trim());
  s = applyServiceLexiconFixes(s, serviceNames);
  s = applyLocationFarClosingFix(s);
  s = applyIllnessPhilosophyFix(s);
  s = stripPolicyFluffPreamble(s);
  s = stripCoachingAndUnsolicitedRegisterPush(s);
  const addressingMode = resolveWaReplyAddressingMode(input.knowledge);
  s = fixNeutralGenderedWantAndHowTo(s, addressingMode);
  if (addressingMode !== "feminine") {
    s = fixNeutralLeadPluralAddressing(s);
  }
  if (!s) return s;

  if (input.multiServiceAwaitingPick) {
    s = stripServicePickInvitationLines(s);
  }

  if (input.scheduleSlotsWithPickedService && input.selectedServiceName?.trim()) {
    const mode = resolveWaReplyAddressingMode(input.knowledge);
    s = fixWrongScheduleSlotsInterest(s, input.selectedServiceName.trim(), mode);
    s = sanitizeZoeOutboundLanguage(s);
  }

  if ((input.scheduleDayLabels?.length ?? 0) > 0) {
    s = applyScheduleDayGarbleFixes(s, input.scheduleDayLabels!);
  }

  s = stripFakeScheduleImagePlaceholders(s);
  s = scrubCustomerFacingPlatformLeak(s.replace(/\n{3,}/g, "\n\n").trim());
  if (input.trialRegistered !== true) {
    s = stripFabricatedSeeYouAtSlot(s);
    s = stripPrematureAfterRegistration(s);
    s = ensureScheduleWhenConvenientQuestion(s);
  }
  return s;
}
