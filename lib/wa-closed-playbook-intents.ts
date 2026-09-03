import { matchesClassRescheduleUpdate } from "@/lib/wa-class-reschedule";
import type { ClosedPlaybookIntent, ClosedPlaybookShape } from "@/lib/wa-closed-playbook-types";

const MAX_LEN = 1200;

export function normalizePlaybookInbound(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function tooLongOrEmpty(t: string): boolean {
  return !t || t.length > MAX_LEN;
}

/** Illness check-in — handled elsewhere; must not become medical playbook. */
export function matchesIllnessCheckIn(raw: string): boolean {
  const t = normalizePlaybookInbound(raw);
  if (!t) return false;
  if (/(?:פציע|פצוע|שבר|נקע|שיקום|דיסק|injury|rehab)/iu.test(t)) return false;
  return (
    /לא\s+מרגיש(?:ה|ים)?\s+טוב/u.test(t) ||
    /לא\s+בטוב/u.test(t) ||
    /(?:^|\s)חולה(?:\s|$|[.,!?])/u.test(t) ||
    /\b(?:i(?:['’]m|\s+am)\s+)?(?:sick|unwell|under\s+the\s+weather)\b/i.test(t)
  );
}

/** Price question — must not become discount negotiation. */
export function matchesPlainPriceQuestion(raw: string): boolean {
  const t = normalizePlaybookInbound(raw);
  if (!t) return false;
  if (/(?:הנח[הא]|מבצע|זול\s+יותר|להוזיל|discount|cheaper|better\s+price)/iu.test(t)) {
    return false;
  }
  return /כמה\s+עולה|מה\s+המחיר|עלות\s+של|\bhow\s+much\b|\bwhat(?:['’]s|\s+is)\s+the\s+price\b/iu.test(
    t
  );
}

export function looksLikePersonalDoItRequest(t: string): boolean {
  return (
    /(?:תבטל(?:י|ו)?|תקפיא(?:י|ו)?|תחזיר(?:י|ו)?|תעשי(?:י)?\s+לי|תטפל(?:י|ו)?\s+(?:לי|בזה))/u.test(t) ||
    /אני\s+רוצ(?:ה|ה)\s+(?:ש)?(?:תבטל|תקפיא|תחזיר|לבטל|להקפיא)/u.test(t) ||
    /(?:freeze|cancel|refund|postpone|reschedule)\s+my\b/i.test(t) ||
    /please\s+(cancel|freeze|refund|reschedule)/i.test(t)
  );
}

function looksLikePolicyQuestion(t: string): boolean {
  if (/מדיניות/u.test(t) || /policy/i.test(t)) return true;
  if (/[?؟]/.test(t) && /(?:אפשר|ניתן|איך|כיצד|can\s+i|how\s+do)/iu.test(t)) return true;
  return /(?:^|\s)(?:אפשר|ניתן|איך|כיצד)\s/u.test(t);
}

function shapeFromFlags(t: string, action: boolean, policy: boolean): ClosedPlaybookShape | null {
  if (!action && !policy) return null;
  if (looksLikePersonalDoItRequest(t)) return "action";
  if (
    /(?:^|[\s,])(?:לי|שלי)(?:\s|$)/u.test(t) &&
    /(?:מנוי|הרשמ|כרטיס)/u.test(t) &&
    /(?:בטל|הקפא|החזר)/u.test(t) &&
    !/מדיניות/u.test(t)
  ) {
    return "action";
  }
  if (
    /\bmy\s+(membership|registration|booking|class)\b/i.test(t) &&
    /(cancel|freeze|refund)/i.test(t) &&
    !/policy/i.test(t)
  ) {
    return "action";
  }
  if (policy && looksLikePolicyQuestion(t)) return "policy";
  if (action) return "action";
  if (policy) return "policy";
  return null;
}

function intent(
  category: ClosedPlaybookIntent["category"],
  shape: ClosedPlaybookShape
): ClosedPlaybookIntent {
  return { category, shape };
}

/** ביטול/החלפת שיעור באפליקציה — לא ביטול מנוי ולא הקפאה. */
export function matchClassCancelPlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;
  const n = t.toLowerCase();

  if (
    /לבטל.{0,40}(?:את\s+)?ה?(?:מנוי|כרטיסי[יה]|חבילה)/u.test(t) &&
    !/(?:שיעור|אימון)/u.test(t)
  ) {
    return null;
  }

  const cancelOrSwitchClass =
    /לבטל.{0,48}(?:את\s+)?ה?(?:אימון|שיעור)/u.test(t) ||
    /תבטל(?:י|ו)?\s+(?:לי\s+)?(?:את\s+)?ה?(?:שיעור|אימון)/u.test(t) ||
    /בטל(?:י|ו)\s+(?:לי\s+)?(?:את\s+)?ה?(?:שיעור|אימון)/u.test(t) ||
    /ביטול.{0,24}(?:ה)?(?:אימון|שיעור)/u.test(t) ||
    /לבטל.{0,32}הרשמ(?:ה)?\s+ל(?:שיעור|אימון)/u.test(t) ||
    /(?:אפשר|ניתן|איך|כיצד)\s+לבטל.{0,40}(?:שיעור|אימון|הרשמ(?:ה)?\s+ל)/u.test(t) ||
    /להחליף\s+(?:את\s+)?ה?(?:שיעור|אימון)/u.test(t) ||
    /(?:אפשר|ניתן|איך)\s+להחליף\s+שיעור/u.test(t) ||
    /cancel.{0,40}(?:a\s+|the\s+|my\s+)?(?:class|session|lesson|spot)\b/i.test(n) ||
    /please\s+cancel.{0,24}(?:the\s+|my\s+)?(?:class|session|lesson)/i.test(n) ||
    /how\s+(?:do\s+i|can\s+i)\s+cancel.{0,24}(?:class|session|lesson)/i.test(n);

  if (!cancelOrSwitchClass) return null;

  const policy = looksLikePolicyQuestion(t) || /(?:אפשר|ניתן|איך|כיצד)\s+(?:לבטל|להחליף)/u.test(t);
  return intent("class_cancel", policy ? "policy" : "action");
}

/** Cancellation of membership / registration — split out of reschedule. */
export function matchCancellationPlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;
  if (matchClassCancelPlaybook(t)) return null;
  const n = t.toLowerCase();

  const action =
    /לבטל.{0,40}את\s+ההרשמ/u.test(t) ||
    /תבטל(?:י|ו)?\s+(?:לי\s+)?את\s+ההרשמ/u.test(t) ||
    /בטל(?:י|ו)\s+(?:לי\s+)?את\s+ההרשמ/u.test(t) ||
    /לבטל.{0,40}(?:את\s+)?ה?(?:מנוי|כרטיסי[יה]|חבילה)/u.test(t) ||
    /תבטל(?:י|ו)?.{0,24}(?:מנוי|כרטיסי|הרשמ|חבילה)/u.test(t) ||
    /רוצ(?:ה|ה)\s+לבטל.{0,32}(?:מנוי|הרשמ|כרטיסי|חבילה)/u.test(t) ||
    /ביטול\s+(?:של\s+)?(?:ה)?(?:מנוי|הרשמ|כרטיסי)/u.test(t) &&
      !/מדיניות/u.test(t) ||
    /\bcancel\s+(my\s+)?(registration|booking|membership|subscription)\b/i.test(n);

  const policy =
    /מדיניות\s+ה?ביטול/u.test(t) ||
    /(?:איך|כיצד)\s+מבטל(?:ים)?/u.test(t) ||
    /(?:אפשר|ניתן|אפשרי)\s+לבטל(?:\s|$|\?|.{0,24}(?:מנוי|הרשמ|כרטיסי))/u.test(t) ||
    /what(?:['’]s|\s+is)\s+the\s+cancellation\s+policy/i.test(n) ||
    /can\s+i\s+cancel\s+(a\s+|the\s+|my\s+)?(membership|registration|subscription)/i.test(n);

  const shape = shapeFromFlags(t, action, policy);
  if (!shape) return null;
  return intent("cancellation", shape);
}

export function matchReschedulePlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;
  if (matchClassCancelPlaybook(t)) return null;
  if (matchCancellationPlaybook(t)) return null;

  if (matchesClassRescheduleUpdate(t)) return intent("reschedule", "action");

  const policy =
    /(?:אפשר|ניתן|אפשרי)\s+ל(?:דחות|החליף|שנות)\s+(?:את\s+)?ה?(?:שיעור|אימון|מועד)/u.test(t) ||
    /מדיניות\s+(?:דחי|החלפ|שינוי\s+מועד)/u.test(t) ||
    /(?:איך|כיצד)\s+(?:דוחים|משנים|מחליפים)\s+(?:שיעור|אימון|מועד)/u.test(t) ||
    /can\s+i\s+(reschedule|postpone|change)\s+(my\s+)?(class|session|lesson|time)/i.test(t) ||
    /(?:reschedule|postpone)\s+policy/i.test(t);

  if (policy) return intent("reschedule", "policy");
  return null;
}

export function matchFreezePlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;
  if (matchClassCancelPlaybook(t)) return null;
  if (!/הקפא|קפיא|\bfreeze\b/iu.test(t)) return null;

  const action =
    /תקפיא(?:י|ו)?\s+(?:לי\s+)?את\s+ה?(?:מנוי|כרטיסי)/u.test(t) ||
    /(?<!לא\s)רוצ(?:ה|ה)\s+להקפיא/u.test(t) ||
    /להקפיא\s+(?:לי\s+)?את\s+ה?(?:מנוי|כרטיסי)/u.test(t) &&
      !/(?:אפשר|ניתן|מדיניות)/u.test(t) ||
    /please\s+freeze\s+my/i.test(t) ||
    /freeze\s+my\s+(membership|account|card)/i.test(t);

  const policy =
    /מדיניות\s+ה?הקפא/u.test(t) ||
    /(?:אפשר|ניתן|אפשרי)\s+להקפיא/u.test(t) ||
    /(?:איך|כיצד)\s+מקפיא(?:ים)?/u.test(t) ||
    /can\s+i\s+freeze\s+(a\s+|the\s+|my\s+)?(membership|account)?/i.test(t) ||
    /freeze\s+policy/i.test(t);

  const shape = shapeFromFlags(t, action, policy);
  if (!shape) return null;
  return intent("freeze", shape);
}

export function matchRefundPlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;

  const action =
    /(?:רוצ(?:ה|ה)\s+)?(?:החזר|לקבל\s+החזר)/u.test(t) && !/מדיניות/u.test(t) ||
    /תחזיר(?:י|ו)?\s+(?:לי\s+)?(?:את\s+)?(?:ה)?כסף/u.test(t) ||
    /להחזיר\s+(?:לי\s+)?כסף/u.test(t) ||
    /refund\s+(?:my|please|me)\b/i.test(t) ||
    /i\s+want\s+a\s+refund/i.test(t);

  const policy =
    /מדיניות\s+ה?החזר/u.test(t) ||
    /(?:אפשר|ניתן)\s+(?:לקבל\s+)?החזר/u.test(t) ||
    /refund\s+policy/i.test(t) ||
    /can\s+i\s+(get|have)\s+a\s+refund/i.test(t);

  if (!/החזר|refund|להחזיר\s+(?:לי\s+)?כסף|תחזיר(?:י|ו)?\s+(?:לי\s+)?(?:את\s+)?(?:ה)?כסף/iu.test(t)) {
    return null;
  }

  const shape = shapeFromFlags(t, action, policy);
  if (!shape) return null;
  return intent("refund", shape);
}

export function matchMedicalPlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;
  if (matchesIllnessCheckIn(t)) return null;

  const injury =
    /פציע|פצוע|פצועה|שיקום|פיזיותרפ|שבר(?:תי)?|נקע|דיסק|פריצת\s+דיסק|כאבי?\s+גב|כאב\s+ברך|ברכיים|injur(?:y|ies)|rehab|physiotherap/iu.test(
      t
    );
  if (!injury) return null;

  const policy =
    /(?:אפשר|ניתן|מתאים)\s+(?:להתאמן|לאימון|לשיעור)/u.test(t) ||
    /מדיניות.{0,16}(?:פציע|שיקום)/u.test(t) ||
    /can\s+i\s+(still\s+)?(train|work\s+out|come\s+to\s+class)/i.test(t) ||
    /(?:is\s+it\s+)?ok\s+(?:to\s+)?(?:train|work\s+out)/i.test(t);

  return intent("medical", policy ? "policy" : "action");
}

export function matchComplaintPlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;

  const complaint =
    /תלונ[הא]/u.test(t) ||
    /לא\s+מרוצ(?:ה|ים)/u.test(t) ||
    /חווי[הא].{0,24}(?:גרוע|רע|מאכזב)/u.test(t) ||
    /(?:המאמנ(?:ת)?|המדריכ(?:ה)?|המקום|המתקן|הסטודיו).{0,32}(?:גרוע|גסה|לא\s+בסדר|מלוכלך|לא\s+מקצוע)/u.test(
      t
    ) ||
    /(?:גרוע|גסה|מלוכלך|לא\s+מקצוע).{0,32}(?:המאמנ|המדריכ|המקום|הסטודיו)/u.test(t) ||
    /\bcomplaint\b/i.test(t) ||
    /disappointed\s+(?:with|in)\s+(?:the\s+)?(coach|studio|class|facility)/i.test(t) ||
    /the\s+(coach|instructor|studio|facility)\s+was\s+(rude|awful|dirty|unprofessional)/i.test(t);

  if (!complaint) return null;
  const policy = /מדיניות.{0,16}תלונ/u.test(t) || /how\s+do\s+(?:i|you)\s+file\s+a\s+complaint/i.test(t);
  return intent("complaint", policy ? "policy" : "action");
}

export function matchGroupPlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;

  const group =
    /סדנ[הא]\s+פרטית/u.test(t) ||
    /אימון\s+פרטי\s+(?:לקבוצה|לחברה|לצוות)/u.test(t) ||
    /יום\s+גיבוש/u.test(t) ||
    /(?:קבוצה|צוות|חברה)\s+(?:מהעבודה|מהמשרד)/u.test(t) ||
    /אירוע\s+ל?(?:חברה|גיבוש|משרד)/u.test(t) ||
    /מסיבת\s+(?:רווקות|יום\s+הולדת).{0,24}(?:אצלכם|סטודיו|אימון)/u.test(t) ||
    /private\s+workshop/i.test(t) ||
    /(?:corporate|company|team)\s+(?:event|workshop|offsite)/i.test(t) ||
    /group\s+(?:booking|session|workshop)\s+for\s+(?:work|our\s+team|the\s+office)/i.test(t);

  if (!group) return null;
  const policy =
    /(?:אפשר|ניתן)\s+(?:לסגור|להזמין|לקיים)/u.test(t) ||
    /do\s+you\s+(offer|host|do)\s+(private\s+workshops|corporate)/i.test(t);
  return intent("group", policy ? "policy" : "action");
}

export function matchDiscountPlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;
  if (matchesPlainPriceQuestion(t)) return null;

  const negotiate =
    /תעשי(?:י)?\s+לי\s+(?:הנח[הא]|מחיר)/u.test(t) ||
    /(?:תוריד(?:י)?|תוזיל(?:י)?)\s+(?:לי\s+)?(?:את\s+)?ה?מחיר/u.test(t) ||
    /מחיר\s+יותר\s+זול|זול\s+יותר/u.test(t) ||
    /אפשר\s+(?:הנח[הא]|להוזיל|לרדת\s+במחיר)/u.test(t) ||
    /תעשו\s+לי\s+הנח/u.test(t) ||
    /special\s+price|better\s+price|do\s+(?:me\s+)?a\s+discount/i.test(t) ||
    /can\s+you\s+(do|give)\s+(me\s+)?(a\s+)?(discount|cheaper)/i.test(t) ||
    /i\s+want\s+a\s+discount/i.test(t);

  if (!negotiate) return null;
  return intent("discount", "action");
}

export function matchCoachOwnerPlaybook(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;

  const person =
    /ה?מאמנ(?:ת|ים)?|ה?מדריכ(?:ה|ים)?|בעל(?:י)?\s*העסק|ה?בעלים|בעלת\s+העסק|ה?מנהל(?:ת)?|head\s+coach|\bthe\s+owner\b|\bthe\s+coach\b|\bthe\s+instructor\b/iu.test(
      t
    );
  if (!person) return null;

  const contact =
    /לדבר\s+עם|תעביר(?:י|ו)?\s+ל|תחבר(?:י|ו)?\s+אותי|אפשר\s+(?:לדבר|את\s+המספר|ליצור\s+קשר)|רוצ(?:ה|ה)\s+לדבר\s+עם|מספר\s+(?:של\s+)?ה?(?:מאמנ|מדריכ|בעל)|talk\s+to\s+(the\s+)?(owner|coach|instructor)|speak\s+to\s+(the\s+)?(owner|coach)|put\s+me\s+through/i.test(
      t
    );
  if (!contact) return null;
  return intent("coach_owner", "action");
}

/**
 * Most specific first. Off-topic (#9) and freeze-billing-dispute stay outside this list.
 */
const DETECTORS: Array<(raw: string) => ClosedPlaybookIntent | null> = [
  matchMedicalPlaybook,
  matchComplaintPlaybook,
  matchRefundPlaybook,
  matchClassCancelPlaybook,
  matchFreezePlaybook,
  matchCancellationPlaybook,
  matchReschedulePlaybook,
  matchGroupPlaybook,
  matchDiscountPlaybook,
  matchCoachOwnerPlaybook,
];

export function detectClosedPlaybookIntent(raw: string): ClosedPlaybookIntent | null {
  const t = normalizePlaybookInbound(raw);
  if (tooLongOrEmpty(t)) return null;
  const classCancel = matchClassCancelPlaybook(t);
  if (classCancel) return classCancel;
  if (matchesIllnessCheckIn(t)) return null;
  if (matchesPlainPriceQuestion(t)) return null;
  for (const detect of DETECTORS) {
    const hit = detect(t);
    if (hit) return hit;
  }
  return null;
}
