import { looksLikeLeadQuestion } from "@/lib/wa-split-answer";
import {
  isSalesFlowStartTrigger,
  type SalesFlowStartTriggerOpts,
} from "@/lib/sales-flow-start-triggers";

function normalizeSalesFlowPauseText(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .replace(/[*_~`]/g, "")
    .replace(/[/\\]/g, " ")
    .replace(/[!.,?;:~'"„"\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * הליד אומר במפורש שיחזור / יהיה בקשר / לא ממשיך עכשיו.
 * עדיין מעוניין — לא «לא רלוונטי». «בקשר ל…» (לגבי) לא נספר.
 */
export function leadPausesSalesFlowNow(text: string): boolean {
  const rawLower = String(text ?? "").trim().toLowerCase();
  if (/\bi(?:['’]ll| will)\s+be\s+in\s+touch\b/.test(rawLower)) return true;
  if (/\bi(?:['’]ll| will)\s+get\s+back\b/.test(rawLower)) return true;

  const t = normalizeSalesFlowPauseText(text);
  if (!t) return false;

  if (/(?:אהיה|נהיה|אשאר|נישאר)\s+בקשר/.test(t)) return true;
  if (/\bi(?:\s+ll| will)\s+be\s+in\s+touch\b/.test(t)) return true;
  if (/\bi(?:\s+ll| will)\s+get\s+back\b/.test(t)) return true;

  if (/אחזור(?:י)?\s+(?:אלי[יךםן]?|בהמשך|יותר\s+מאוחר|מאוחר\s+יותר)/.test(t)) return true;
  if (/נחזור\s+(?:אלי[יךםן]?|בהמשך|יותר\s+מאוחר|מאוחר\s+יותר)/.test(t)) return true;

  if (/(?:נדבר|נשמע)\s+(?:בהמשך|יותר\s+מאוחר|מאוחר\s+יותר)/.test(t)) return true;
  if (/\b(?:maybe\s+later|not\s+right\s+now|not\s+now)\b/.test(t)) return true;

  if (/^(?:לא\s+עכשיו|כרגע\s+לא|בינתיים\s+לא)(?:\s+תודה)?$/.test(t)) return true;
  if (/\bלא\s+עכשיו\b/.test(t) && /תודה/.test(t)) return true;

  return false;
}

/**
 * זואי כבר העבירה לצוות — לא ממשיכים את פלואו המכירה, גם אם הליד שאל שאלה.
 * כולל «הבקשה» (לא רק «הפנייה») כי זה הנוסח בהנחיות.
 */
export function assistantReplyIndicatesTeamHandoff(text: string): boolean {
  const t = normalizeSalesFlowPauseText(text);
  if (!t) return false;
  // «הבקשה» וגם סמיכות «בקשת הביטול» / «אעביר את הבקשה».
  if (/(?:מ|א)עביר(?:ה|ים)?\s+את\s+(?:ה)?(?:פני|בקש|זה)/.test(t)) return true;
  if (/(?:מ|א)עביר(?:ה|ים)?(?:\s+\S+){0,6}\s+לצוות/.test(t)) return true;
  if (/אעביר\s+את\s+ההודעה\s+לצוות/.test(t)) return true;
  if (/pass(?:ing)?\s+(?:it|this|that|the message|your message)\s+to\s+the\s+team/.test(t)) return true;
  if (/יצרו\s+איתך\s+קשר/.test(t)) return true;
  if (/הצוות\s+יצרו/.test(t)) return true;
  if (/the\s+team\s+will\s+(?:get\s+in\s+touch|contact|reach\s+out)/.test(t)) return true;
  return false;
}

const THANKS_ONLY_WORDS = new Set([
  "תודה",
  "רבה",
  "לך",
  "לכם",
  "לי",
  "מראש",
  "היי",
  "הי",
  "שלום",
  "אהלן",
  "אוקיי",
  "אוקי",
  "סבבה",
  "מעולה",
  "מצוין",
  "מצויין",
  "מצוינת",
  "מצויינת",
  "נהדר",
  "יופי",
  "אחלה",
  "בסדר",
  "כן",
  "על",
  "העזרה",
  "הכל",
  "הכול",
  "הטיפול",
  "המענה",
  "זה",
  "thanks",
  "thank",
  "you",
  "so",
  "much",
  "a",
  "lot",
  "ok",
  "okay",
  "спасибо",
]);

/** «תודה» / «תודה רבה» בלי שאלה ובלי בקשה חדשה. «לא תודה» אינו זה. */
export function isThanksOnlyMessage(text: string): boolean {
  const t = normalizeSalesFlowPauseText(text).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 80) return false;
  if (t.startsWith("לא ") || t.includes("לא תודה")) return false;
  const words = t.split(" ").filter(Boolean);
  if (!words.length || words.length > 8) return false;
  if (!words.some((w) => w === "תודה" || w === "thanks" || w === "thank" || w === "спасибо")) {
    return false;
  }
  return words.every((w) => THANKS_ONLY_WORDS.has(w));
}

/** תשובת זואי שכבר סגרה בנימוס («נחזור כשתהיו מוכנים») — בלי לדחוף לשלב הבא. */
export function assistantReplyIndicatesSalesFlowPause(text: string): boolean {
  const t = normalizeSalesFlowPauseText(text);
  if (!t) return false;
  if (assistantReplyIndicatesTeamHandoff(text)) return true;
  if (/כשתהי[הי]\s+מוכנ/.test(t)) return true;
  if (/כשתהיו\s+מוכנים/.test(t)) return true;
  if (/כשיהיה\s+לך\s+(?:מתאים|זמן)/.test(t)) return true;
  if (/אנחנו\s+כאן\s+כש/.test(t)) return true;
  if (/חזרה\s+בכל\s+עת/.test(t)) return true;
  if (/מוזמנ\S*\s+חזרה/.test(t)) return true;
  if (/we(?:['’]re| are)\s+here\s+when(?:\s+you(?:['’]re| are))?\s+ready/.test(t)) return true;
  return false;
}

/**
 * לדלג על שליחה מחדש של שלב הפלואו אחרי תשובת AI.
 * שאלה פתוחה אמיתית ממשיכה את הפלואו גם אם זואי ניסחה סגירה רכה —
 * חוץ מהעברה לצוות, שאז אסור לדחוף תפריט מועדים/מכירה.
 * חריג: מילת פתיחה («אשמח לפרטים» / «בואו נתחיל») פותחת מחדש את פלואו המכירה.
 */
export function shouldPauseSalesFlowPromptResend(input: {
  inboundText?: string;
  assistantReply?: string;
  salesFlowStartOpts?: SalesFlowStartTriggerOpts;
}): boolean {
  const inbound = String(input.inboundText ?? "").trim();
  const reply = String(input.assistantReply ?? "").trim();
  if (inbound && leadPausesSalesFlowNow(inbound)) return true;
  if (inbound && isSalesFlowStartTrigger(inbound, input.salesFlowStartOpts)) return false;
  if (reply && assistantReplyIndicatesTeamHandoff(reply)) return true;
  if (inbound && looksLikeLeadQuestion(inbound)) return false;
  if (reply && assistantReplyIndicatesSalesFlowPause(reply)) return true;
  return false;
}
