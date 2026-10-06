import type { ClosedPlaybookCategory } from "@/lib/wa-closed-playbook-types";
import { buildClassRescheduleTeamHandoffReply } from "@/lib/wa-class-reschedule";
import { detectMessageLanguage } from "@/lib/language-detect";

export const CLOSED_PLAYBOOK_CANCELLATION_REPLY =
  "אני מבינה, אני אעביר את הבקשה לביטול לצוות שלנו והם יחזרו אלייך בהקדם 💜";

export const CLOSED_PLAYBOOK_CLASS_CANCEL_REPLY =
  "מצטערת לשמוע! 💜 אפשר לבטל את ההרשמה ישירות מהאפליקציה Arbox - נכנסים, מוצאים את השיעור ומבטלים את ההרשמה. אם המערכת לא נותנת לך לבטל - אני אעביר את זה לצוות וידאגו שלך בהקדם! כשתרצי לחזור - אנחנו כאן 💜";

/** רשת ביטחון גנרית: בקשת יומן שלא נתפסה בפלייבוק כלל — אין גישה ליומן, מעבירים לצוות. */
export const CLOSED_PLAYBOOK_CLASS_CANCEL_ACTION_REPLY =
  "אין לי את הפרטים על השיעור הזה - אני מעבירה את הבקשה לצוות והם יטפלו בזה 💜";

export const CLOSED_PLAYBOOK_FREEZE_REPLY =
  "בשמחה, אני מעבירה את בקשת ההקפאה לצוות - הם יטפלו בזה מולך 💜";

export const CLOSED_PLAYBOOK_REFUND_REPLY =
  "אני מבינה, אני אעביר את הפנייה ישירות לצוות - הם יחזרו אלייך 💜";

export const CLOSED_PLAYBOOK_MEDICAL_REPLY =
  "בנושא כזה חשוב לדבר עם הצוות ישירות ולא איתי - אני מעבירה אליהם את הפנייה ויחזרו אלייך 💜";

export const CLOSED_PLAYBOOK_COMPLAINT_REPLY =
  "אני מצטערת לשמוע, אני מעבירה את זה כעת לצוות שלנו וידאגו לחזור אלייך בהקדם 💜";

export const CLOSED_PLAYBOOK_GROUP_REPLY =
  "איזה כיף! אני מעבירה את זה לצוות, הם ידברו איתך על הפרטים 💜";

export const CLOSED_PLAYBOOK_DISCOUNT_NO_PROMO_REPLY =
  "אין לי ממש יכולת לעזור כאן אבל אני יכולה להעביר את זה לצוות שיצרו איתך קשר ✨";

export const CLOSED_PLAYBOOK_COACH_OWNER_REPLY = "בשמחה, אני מעבירה את זה ישירות אליהם 💜";

/** שאלה על כלל (חלון ביטול, הקפאה, החזר) כשאין תשובה מוגדרת. לא בקשה לבצע. */
export const CLOSED_PLAYBOOK_POLICY_QUESTION_REPLY =
  "אין לי את המידע הזה כרגע, אני מעבירה את השאלה לצוות והם יחזרו אלייך בהקדם 💜";

/**
 * ביטול/החלפת שיעור בלי ארבוקס ובלי עובדה בידע — העברה לצוות שמזכירה את הבקשה.
 */
export function buildNonArboxClassChangeTeamHandoffReply(inbound: string): string {
  const lang = detectMessageLanguage(inbound);
  const ref = classChangeRequestReference(inbound);
  if (lang === "en") {
    const quoted = clipInboundQuote(inbound);
    return quoted
      ? `I'm passing your request to the team («${quoted}»). They'll get back to you.`
      : "I'm passing your request to the team. They'll get back to you.";
  }
  if (lang === "ru") {
    const quoted = clipInboundQuote(inbound);
    return quoted
      ? `Передаю ваш запрос команде («${quoted}»). Они свяжутся с вами.`
      : "Передаю ваш запрос команде. Они свяжутся с вами.";
  }
  const empathy = /לצערי|חולה|לא\s+מרגיש|לא\s+בטוב|לא\s+יכול(?:ה|ים)?\s+להגיע|מצטער/u.test(inbound);
  const open = empathy ? "מצטערת לשמוע! " : "";
  const about = ref ? `את הבקשה ${ref}` : "את הבקשה";
  return `${open}אני מעבירה לצוות ${about}. הם יחזרו אלייך בהקדם 💜`;
}

function classChangeRequestReference(raw: string): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const day = /היום/u.test(t) ? "של היום" : /מחר/u.test(t) ? "של מחר" : "";
  const wantsSwitch = /להחליף|להעביר|לדחות|תעביר/u.test(t);
  const wantsCancel = /לבטל|תבטל|בטל(?:י|ו)|ביטול|צריכ(?:ה|ים)?\s+לבטל|תמחק/u.test(t);
  if (wantsSwitch && wantsCancel) {
    return day ? `לבטל או להחליף את השיעור ${day}` : "לבטל או להחליף את השיעור";
  }
  if (wantsSwitch) return day ? `להחליף את השיעור ${day}` : "להחליף את השיעור";
  if (wantsCancel) return day ? `לבטל את ההרשמה ${day}` : "לבטל את ההרשמה לשיעור";
  const quoted = clipInboundQuote(t);
  return quoted ? `«${quoted}»` : "";
}

function clipInboundQuote(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/[💜🙂()]+/gu, "")
    .trim()
    .slice(0, 70)
    .trim();
}

/** נוסח גנרי של «נכנסים לאפליקציה ומבטלים» — לא תשובה מידע עסקי. */
export function replyGivesGenericClassCancelAppHowTo(text: string): boolean {
  const t = String(text ?? "").replace(/\s+/g, " ");
  if (!/אפליקצי/u.test(t)) return false;
  return /נכנסים/u.test(t) && /(?:מבטלים|בוטלים|מוצאים את השיעור)/u.test(t);
}

export function buildClosedPlaybookDefaultReply(
  category: ClosedPlaybookCategory,
  botName?: string | null
): string {
  switch (category) {
    case "reschedule":
      return buildClassRescheduleTeamHandoffReply(botName ?? "");
    case "class_cancel":
      return CLOSED_PLAYBOOK_CLASS_CANCEL_REPLY;
    case "cancellation":
      return CLOSED_PLAYBOOK_CANCELLATION_REPLY;
    case "freeze":
      return CLOSED_PLAYBOOK_FREEZE_REPLY;
    case "refund":
      return CLOSED_PLAYBOOK_REFUND_REPLY;
    case "medical":
      return CLOSED_PLAYBOOK_MEDICAL_REPLY;
    case "complaint":
      return CLOSED_PLAYBOOK_COMPLAINT_REPLY;
    case "group":
      return CLOSED_PLAYBOOK_GROUP_REPLY;
    case "discount":
      return CLOSED_PLAYBOOK_DISCOUNT_NO_PROMO_REPLY;
    case "coach_owner":
      return CLOSED_PLAYBOOK_COACH_OWNER_REPLY;
  }
}

export function closedPlaybookModelUsed(
  category: ClosedPlaybookCategory,
  source: "default" | "fact" | "promo" | "catalog"
): string {
  if (source === "promo") return "closed_playbook_promo";
  if (source === "catalog") return `closed_playbook_catalog_${category}`;
  if (source === "fact") return `closed_playbook_fact_${category}`;
  if (category === "reschedule") return "class_reschedule_team_handoff";
  return `closed_playbook_${category}`;
}
