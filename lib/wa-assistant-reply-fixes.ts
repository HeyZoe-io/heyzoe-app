import type { BusinessKnowledgePack } from "@/lib/business-context";
import {
  formatCourseCyclesForKnowledge,
  formatScheduleSlotsForKnowledge,
  HEBREW_DAY_OPTIONS,
  type CourseCycle,
  type ProductScheduleSlot,
} from "@/lib/product-schedule-slots";

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

function applyTypoFixes(text: string): string {
  return String(text ?? "")
    .replace(/\bאימן\b/gu, "אימון")
    .replace(/לא\s+יש\s+לי\s+את/giu, "אין לי את")
    .replace(/לא\s+יש\s+לי\b/giu, "אין לי")
    .replace(/לא\s+יש\s+מידע/giu, "אין לי מידע")
    .replace(/נירשמ/gu, "נרשמ")
    .replace(/נרישמ/gu, "נרשמ")
    .replace(/מצליחה\s+בחיפוש/giu, "בהצלחה בחיפוש");
}

/** מקף ארוך/בינוני → מקף רגיל (כלל זואי בוואטסאפ). */
function normalizeWaDashes(text: string): string {
  return String(text ?? "").replace(/[—–]/g, "-");
}

/** סיום ארוך כשהמיקום לא מתאים → ניסוח קצר קבוע. */
function applyLocationFarClosingFix(text: string): string {
  let s = String(text ?? "");
  s = s.replace(
    /אם בא לך ללמוד עוד על זה או אם משהו משתנה בעתיד\s*[-–—]?\s*את(?:ם|הן)?\s+מוזמנ(?:ים|ות)?\s+בחזרה\.?\s*(?:מצליחה|בהצלחה)\s+בחיפוש\s+הסטודיו\s+המתאים!\s*🙂?/giu,
    "אם משהו ישתנה בעתיד, אנחנו כאן :)"
  );
  s = s.replace(
    /אם בא לך ללמוד עוד על זה או אם משהו משתנה בעתיד[^.!?\n]*[.!?]?\s*(?:מצליחה|בהצלחה)\s+בחיפוש\s+הסטודיו\s+המתאים!\s*🙂?/giu,
    "אם משהו ישתנה בעתיד, אנחנו כאן :)"
  );
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
      : "ניטרלי: «יש עניין», «אפשר», «ניתן» — לא «את מעניינת», לא «תוכלי/אוכלת לבחור».";

  return `
איות וניסוח (חובה לפני סיום התשובה):
- לקסיקון מהדשבורד: שמות אימונים, מחירים, FAQ ומועדים - מהשדות «ידע עסקי» ומהשורות למטה; פרפרזה רק לגוון, בלי לשנות שמות שירות, ימי שבוע (רביעי, שלישי…) או שעות.
- איות: «אימון» לא «אימן»; «אין לי» לא «לא יש לי»; «בהצלחה» לא «מצליחה».
- מקף: רק מקף רגיל (-). אסור מקף ארוך (—) או מקף בינוני (–).
- כשהליד רחוק מהסטודיו והמיקום לא מתאים: הכירי בזה בקצרה, וסיימי במשפט «אם משהו ישתנה בעתיד, אנחנו כאן :)» - בלי «מוזמנים בחזרה», בלי «בהצלחה בחיפוש», ובלי משפט ארוך.
- ${addressingHint}
- אל תזמיני לבחירת אימון/שיעור ואל תפרטי רשימת אימונים — המערכת שולחת תפריט/שאלה בנפרד מיד אחרייך.
${lexicon ? `- מועדים לאימון שכבר נבחר — העתיקי בדיוק מהשורה: «${lexicon}». לציון מועד בודד: «ביום {יום} בשעה {שעה}» עם שם היום כמו בלקסיקון.` : ""}
${scheduleExample ? `- אם מוזכרים מועדים/זמנים אחרי שכבר נבחר אימון — ניסוח כמו: «${scheduleExample}» (לא «את מעניינת ב… תוכלי לבחור מהזמנים»).` : ""}`;
}

/** post-process על תשובת split לפני שליחה ל-WhatsApp (אפס API). */
export function applyKnownAssistantReplyFixes(
  text: string,
  input: ApplyAssistantReplyFixesInput
): string {
  let s = normalizeWaDashes(applyTypoFixes(String(text ?? "").trim()));
  s = applyLocationFarClosingFix(s);
  if (!s) return s;

  if (input.multiServiceAwaitingPick) {
    s = stripServicePickInvitationLines(s);
  }

  if (input.scheduleSlotsWithPickedService && input.selectedServiceName?.trim()) {
    const mode = resolveWaReplyAddressingMode(input.knowledge);
    s = fixWrongScheduleSlotsInterest(s, input.selectedServiceName.trim(), mode);
    s = applyTypoFixes(s);
  }

  if ((input.scheduleDayLabels?.length ?? 0) > 0) {
    s = applyScheduleDayGarbleFixes(s, input.scheduleDayLabels!);
  }

  return s.replace(/\n{3,}/g, "\n\n").trim();
}
