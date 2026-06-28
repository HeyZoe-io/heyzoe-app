import { normalizeSalesFlowGreetingToken } from "@/lib/sales-flow-start-triggers";

export type WarmupSkipPhase = "opening" | "warmup";

/** נורמליזציה לזיהוי כוונה — lowercase, סימני פיסוק, רווחים. */
export function normalizeWarmupSkipIntentText(raw: string): string {
  return normalizeSalesFlowGreetingToken(raw);
}

/** קידומת דיבור אופציונלית בתחילת המשפט (ב/ו) — לא על «בוא» / «בלי». */
const OPTIONAL_SPEECH_PREFIX = /^(?:[וב]\s*)?/u;

function hasInfoQuestionBlock(t: string): boolean {
  return (
    /(?:^|\s)(?:כמה\s+עולה|מה\s+המחיר|המחיר|מחיר|עולה|עלות|כמה\s+זה)/u.test(t) ||
    /(?:^|\s)(?:איפה\s+אתם|מה\s+הכתובת|כתובת|מיקום)/u.test(t) ||
    /(?:^|\s)(?:מה\s+השעות|מתי\s+יש\s+שיעור|שעות)/u.test(t)
  );
}

/** «יש לי שאלה» — לא סירוב מפורש לחימום. */
function hasQuestionsTrap(t: string): boolean {
  return (
    /^יש\s+לי\s+שאלה$/u.test(t) ||
    /^יש\s+לי\s+שאלות$/u.test(t) ||
    /^אפשר\s+לשאול\s+שאלה$/u.test(t) ||
    /^רוצה\s+לשאול$/u.test(t)
  );
}

function hasPersonalDetailsTrap(t: string): boolean {
  return /פרטים\s+אישיים/u.test(t) || /מילאתי\s+פרטים/u.test(t);
}

function matchesGroupARefuseWarmup(t: string): boolean {
  const p = OPTIONAL_SPEECH_PREFIX.source;
  return (
    new RegExp(`${p}לא\\s+(?:רוצה|בא\\s+לי)\\s+לענות\\s+על\\s+שאלות$`, "u").test(t) ||
    new RegExp(`${p}לא\\s+רוצה\\s+שאלות$`, "u").test(t) ||
    new RegExp(`${p}בלי\\s+שאלות$`, "u").test(t) ||
    new RegExp(`${p}אפשר\\s+בלי\\s+שאלות$`, "u").test(t) ||
    new RegExp(`${p}דלג\\s+על\\s+(?:ה)?שאלות$`, "u").test(t) ||
    new RegExp(`${p}אפשר\\s+לדלג\\s+על\\s+(?:ה)?שאלות$`, "u").test(t) ||
    new RegExp(`${p}די\\s+עם\\s+(?:ה)?שאלות$`, "u").test(t) ||
    new RegExp(`${p}בלי\\s+שאלון$`, "u").test(t) ||
    new RegExp(`${p}אפשר\\s+לקצר$`, "u").test(t)
  );
}

function matchesGroupBAdvance(t: string): boolean {
  return (
    /^בוא(?:י)?\s+נתקדם$/u.test(t) ||
    /^אפשר\s+להתקדם$/u.test(t) ||
    /^בוא(?:י)?\s+נגיע\s+לעניין$/u.test(t) ||
    /^בוא(?:י)?\s+נעבור\s+לעניין$/u.test(t) ||
    /^אפשר\s+לעבור\s+לשלב\s+הבא$/u.test(t) ||
    /^בוא(?:י)?\s+נמשיך\s+הלאה$/u.test(t)
  );
}

function matchesGroupCRegistration(t: string): boolean {
  if (/\b(?:נרשמתי|הצטרפתי)\b/u.test(t)) return false;
  if (new RegExp(`${OPTIONAL_SPEECH_PREFIX.source}רוצה\\s+להתחיל$`, "u").test(t)) return false;
  if (/מתי\s+אפשר\s+להתחיל/u.test(t)) return false;

  const p = OPTIONAL_SPEECH_PREFIX.source;
  if (new RegExp(`${p}(?:איך|איפה)\\s+`, "u").test(t) && /(?:נרשמ|להירשם|מצטרפ|הצטרפ|הרשמה)/u.test(t)) {
    return true;
  }
  if (
    new RegExp(
      `${p}(?:ב)?רוצה\\s+(?:להירשם|להצטרף|לנסות|אימון\\s+ניסיון|לקבוע(?:\\s+אימון)?)$`,
      "u"
    ).test(t)
  ) {
    return true;
  }
  if (new RegExp(`${p}אפשר\\s+(?:להירשם|אימון\\s+ניסיון)$`, "u").test(t)) return true;
  return false;
}

function matchesGroupDDirectInfo(t: string): boolean {
  const p = OPTIONAL_SPEECH_PREFIX.source;
  return (
    new RegExp(`${p}רק\\s+רוצה\\s+פרטים$`, "u").test(t) ||
    new RegExp(`${p}רק\\s+פרטים$`, "u").test(t) ||
    new RegExp(`${p}רק\\s+רוצה\\s+לדעת\\s+פרטים$`, "u").test(t) ||
    new RegExp(`${p}אפשר\\s+לקבל\\s+פרטים$`, "u").test(t) ||
    new RegExp(`${p}רוצה\\s+לשמוע\\s+על\\s+האפשרויות$`, "u").test(t) ||
    new RegExp(`${p}מה\\s+האפשרויות$`, "u").test(t)
  );
}

/** חימום בלבד — לא בפתיחה. */
function matchesWarmupOnlyHowToStart(t: string): boolean {
  return new RegExp(`${OPTIONAL_SPEECH_PREFIX.source}איך\\s+מתחיל(?:ים|ה)?$`, "u").test(t);
}

function matchesEnglishJoinSignup(t: string): boolean {
  return (
    /^how (?:do|can) i (?:sign up|register|join)$/u.test(t) ||
    /^how to (?:sign up|register|join)$/u.test(t) ||
    /^i want to (?:register|join|sign up)$/u.test(t) ||
    /^id like to (?:register|join|sign up)$/u.test(t) ||
    /^i would like to (?:register|join|sign up)$/u.test(t) ||
    /^sign me up$/u.test(t)
  );
}

/**
 * כוונה מפורשת לדלג על שארית פתיחה/חימום — פתיחה או חימום בלבד.
 * לא כולל שאלות מידע (מחיר/כתובת/שעות) ולא מלכודות «שאלה» / «פרטים אישיים».
 */
export function isWarmupSkipIntentText(raw: string, phase: WarmupSkipPhase): boolean {
  const t = normalizeWarmupSkipIntentText(raw);
  if (!t) return false;
  if (hasInfoQuestionBlock(t)) return false;
  if (hasQuestionsTrap(t)) return false;
  if (hasPersonalDetailsTrap(t)) return false;

  if (matchesGroupARefuseWarmup(t)) return true;
  if (matchesGroupBAdvance(t)) return true;
  if (matchesGroupDDirectInfo(t)) return true;
  if (matchesGroupCRegistration(t)) return true;
  if (phase === "warmup" && matchesWarmupOnlyHowToStart(t)) return true;
  return false;
}

/**
 * «איך נרשמים / מצטרפים» — שחזור CTA בשלבים מתקדמים (לא opening/warmup).
 * מורחב מקבוצה ג + ביטויים באנגלית + «איך מתחילים» (תאימות לאחור).
 */
export function isJoinSignupIntentText(raw: string): boolean {
  const t = normalizeWarmupSkipIntentText(raw);
  if (!t) return false;
  if (hasInfoQuestionBlock(t)) return false;
  if (hasQuestionsTrap(t)) return false;
  if (hasPersonalDetailsTrap(t)) return false;

  if (matchesGroupCRegistration(t)) return true;
  if (/^איך\s+מתחיל/u.test(t)) return true;
  if (/^איך\s+(?:קונים|רוכשים|מזמינים|משריינים|שומרים\s+מקום)/u.test(t)) return true;
  if (/^רוצה\s+(?:להירשם|להצטרף)/u.test(t)) return true;
  if (matchesEnglishJoinSignup(t)) return true;
  return false;
}
