import { buildClosedPlaybookDefaultReply } from "@/lib/wa-closed-playbook-copy";
import { lookupPlaybookFact } from "@/lib/wa-closed-playbook-facts";
import type { ClosedPlaybookKnowledge } from "@/lib/wa-closed-playbook-types";

/**
 * Intent tag on a free-text WhatsApp reply. Same Claude/Gemini call, no extra request.
 * Routing lives in code. The tag is stripped before the lead sees the text.
 */
export const WA_REPLY_ROUTES = ["answer", "schedule", "booking_change", "handoff", "signup"] as const;

export type WaReplyRoute = (typeof WA_REPLY_ROUTES)[number];

export type WaReplyRouteTagStatus = "ok" | "missing" | "invalid";

export type ExtractedReplyRoute = {
  route: WaReplyRoute | null;
  body: string;
  tagStatus: WaReplyRouteTagStatus;
};

export type ReplyRouteAction =
  | { kind: "send_body" }
  | { kind: "timetable" }
  | { kind: "booking_change" }
  | { kind: "handoff" };

const LEADING_MARKS_RE = /^[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]+/;

function isWaReplyRoute(value: string): value is WaReplyRoute {
  return (WA_REPLY_ROUTES as readonly string[]).includes(value);
}

function stripRouteTags(raw: string): string {
  return String(raw ?? "")
    .replace(/^[ \t]*\[\[route:[a-z_]+\]\][ \t]*\r?\n?/gim, "")
    .replace(/[ \t]*\[\[route:[a-z_]+\]\][ \t]*/gi, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * First line must be [[route:X]]. Leading whitespace and bidi marks are ignored.
 * A tag-only reply (empty body) is missing, so we do not hand off on a bare tag.
 * Any leftover tag in the body is removed before send.
 */
export function extractReplyRoute(raw: string): ExtractedReplyRoute {
  const original = String(raw ?? "");
  const strippedLead = original.replace(LEADING_MARKS_RE, "");
  const match = /^\[\[route:([a-z_]+)\]\][ \t]*\r?\n?/i.exec(strippedLead);
  if (!match) {
    return { route: null, body: stripRouteTags(original), tagStatus: "missing" };
  }
  const name = String(match[1] ?? "").toLowerCase();
  const after = strippedLead.slice(match[0].length);
  const body = stripRouteTags(after);
  if (!body) {
    return { route: null, body: "", tagStatus: "missing" };
  }
  if (!isWaReplyRoute(name)) {
    return { route: null, body, tagStatus: "invalid" };
  }
  return { route: name, body, tagStatus: "ok" };
}

/**
 * schedule sends the timetable only where that replacement exists today (Tights)
 * and not while the lead is picking a slot in the sales flow.
 * missing/invalid stay on the body. They do not hand off and do not send a timetable.
 */
export function decideReplyRouteAction(input: {
  extracted: ExtractedReplyRoute;
  scheduleImageEnabled: boolean;
  suppressTimetable: boolean;
}): ReplyRouteAction {
  if (input.extracted.tagStatus !== "ok" || !input.extracted.route) {
    return { kind: "send_body" };
  }
  if (input.extracted.route === "schedule") {
    if (input.scheduleImageEnabled && !input.suppressTimetable) return { kind: "timetable" };
    return { kind: "send_body" };
  }
  if (input.extracted.route === "booking_change") return { kind: "booking_change" };
  if (input.extracted.route === "handoff") return { kind: "handoff" };
  return { kind: "send_body" };
}

/** Fact for reschedule if the business wrote one, otherwise the default team-handoff copy. */
export function resolveRouteBookingChangeReply(
  knowledge: ClosedPlaybookKnowledge | null | undefined
): string {
  const fact = lookupPlaybookFact("reschedule", knowledge);
  if (fact && fact.trim()) return fact.trim();
  return buildClosedPlaybookDefaultReply("reschedule", knowledge?.botName);
}

export type ParsedModelUsed = {
  model: string;
  route: WaReplyRoute | null;
  tagStatus: WaReplyRouteTagStatus | null;
  hint: string | null;
};

const MODEL_SUFFIX_RE = /^#route=([a-z_]+);tag=(ok|missing|invalid)(?:;hint=([a-z0-9_]+))?$/;

/** Split "<base>#route=X;tag=Y;hint=Z". Comparisons and groupings use `model` only. */
export function parseModelUsed(value: string | null | undefined): ParsedModelUsed {
  const raw = String(value ?? "").trim();
  const hash = raw.indexOf("#");
  if (hash === -1) return { model: raw, route: null, tagStatus: null, hint: null };
  const model = raw.slice(0, hash);
  const match = MODEL_SUFFIX_RE.exec(raw.slice(hash));
  if (!match) return { model, route: null, tagStatus: null, hint: null };
  const routeName = String(match[1] ?? "");
  const tagStatus = match[2] as WaReplyRouteTagStatus;
  const hint = String(match[3] ?? "").trim() || null;
  if (!isWaReplyRoute(routeName)) return { model, route: null, tagStatus: "invalid", hint };
  return { model, route: routeName, tagStatus, hint };
}

export function modelUsedBase(model: string | null | undefined): string {
  return parseModelUsed(model).model;
}

/** Stored on the assistant row that is already written. No extra update. */
export function appendRouteToModelUsed(
  base: string,
  extracted: ExtractedReplyRoute,
  hint?: string | null
): string {
  const root = modelUsedBase(base) || "unknown";
  const route = extracted.tagStatus === "ok" && extracted.route ? extracted.route : "answer";
  const hintPart = hint && /^[a-z0-9_]+$/.test(hint) ? `;hint=${hint}` : "";
  return `${root}#route=${route};tag=${extracted.tagStatus}${hintPart}`;
}

export function assistantModelOrFilter(names: readonly string[]): string {
  return names
    .flatMap((name) => [`model_used.eq.${name}`, `model_used.like.${name}#*`])
    .join(",");
}

/**
 * Shared WhatsApp free-text prompt (every business, Claude and Gemini).
 * Values are defined by meaning. Examples show the contrast, they are not a matcher.
 */
export function buildReplyRoutePromptBlock(): string {
  return `תג ניתוב (חובה בכל תשובת טקסט חופשי, שורה ראשונה בלבד):
התחילי בדיוק בשורה [[route:X]] ואחר כך ההודעה ללקוח. X הוא אחד מאלה, לפי המשמעות ולא לפי מילה בודדת:
- answer - תשובה רגילה: מחיר, ציוד, כתובת, מדיניות, ברכה, או כל דבר שאינו שאלה על הלוח ואינו שינוי של שיעור שהלקוחה כבר רשומה אליו.
- schedule - הלקוחה שואלת אילו שיעורים או שעות קיימים בלוח, בלי לבקש לשנות שיבוץ שלה.
- booking_change - הלקוחה רוצה לבטל, להעביר, להחליף או לתקן שיעור שהיא כבר רשומה אליו, או מדווחת שנרשמה בטעות. שעה שהיא מציינת בתוך הבקשה היא היעד של השינוי, לא שאלה מה יש בלוח.
- handoff - צריך אדם מהצוות: תלונה, החזר, ביטול מנוי, הקפאה, כאב או מגבלה בגוף, בקשה מפורשת לנציג, בקשה אישית להנחה או למחיר אחר, או שאלה על חלון ביטול שיעור כשהמספר לא נאמר בשיחה. שאלה מה לעשות עם כאב או פציעה היא handoff, גם כשהיא נשמעת כמו שאלה רגילה.
- signup - הלקוחה רוצה להתחיל הרשמה או להצטרף לשיעור או למנוי, ואין לה כבר מקום שהיא מבקשת לשנות.

דוגמאות answer:
- "כמה עולה כרטיסייה?" -> [[route:answer]]
- "צריך להביא מזרן?" -> [[route:answer]]
- "תודה רבה" -> [[route:answer]]
דוגמאות schedule:
- "מה יש ביום שני בבוקר?" -> [[route:schedule]]
- "יש שיעורים אחרי 18:00?" -> [[route:schedule]]
- "מתי יש פילאטיס השבוע?" -> [[route:schedule]]
דוגמאות booking_change (גם כשיש בהן שעה):
- "תמחקו אותי מהשיעור ותעבירו אותי ליום שני" -> [[route:booking_change]]
- "אפשר להזיז אותי מחמישי לשני ב-8:30?" -> [[route:booking_change]]
- "נרשמתי לשיעור הלא נכון, תסדרו לי לשני בבוקר" -> [[route:booking_change]]
- "אני לא מצליחה לבטל באפליקציה את השיעור של מחר ב-19:00" -> [[route:booking_change]]
דוגמאות handoff:
- "אני רוצה לדבר עם המנהלת" -> [[route:handoff]]
- "יש לי תלונה על השיעור" -> [[route:handoff]]
- "אפשר לקבל החזר?" -> [[route:handoff]]
- "אני רוצה לבטל את המנוי" -> [[route:handoff]]
- "תעשי לי הנחה" -> [[route:handoff]]
- "אם אביא חברה אפשר מחיר לזוג?" -> [[route:handoff]]
- "כמה זמן לפני ניתן לבטל שיעור?" כשהמספר לא בשיחה -> [[route:handoff]]
דוגמאות signup:
- "איך נרשמים לשיעור ניסיון?" -> [[route:signup]]
- "אשמח להגיע לשיעור ניסיון" -> [[route:signup]]
- "אשמח על פרטים ומה העלות כדי להצטרף", כשההשערה היא signup -> [[route:signup]]
אם מופיעה שורה Possible intent detected by keyword, זו השערה בלבד ולא עובדה. ברירת המחדל היא answer.
תייגי handoff אם ההשערה עצמה היא מה שהלקוחה מבקשת עכשיו: ביטול מנוי, הקפאה, החזר, נציג, בדיקת מנוי, או מתי נקבע השיעור שלה. תייגי handoff גם בלי השערה כשהבקשה היא הנחה אישית, מחיר אחר, מחיר לזוג, או מחיר לחברה.
תייגי booking_change רק אם היא מבקשת להזיז או לבטל שיעור אחד שהיא כבר רשומה אליו, וההשערה היא על השיעור ולא על המנוי.
תייגי signup כשההשערה היא signup והיא רוצה פרטים או עלות כדי להצטרף.
אם ההשערה אינה signup ואין מחיר בשיחה, בקשה להירשם יחד עם שאלה על עלות היא handoff, לא signup.
מילה מההשערה בתוך בקשה אחרת אינה אישור.
אסור לכתוב אחוז, הנחה, או מבצע שלא כתובים בשדה «הנחות ומבצעים» או בתשובת FAQ. אם השדה מלא, «יש מבצע?» היא answer שמצטטת אותו. אם השדה הוא «לא הוגדר» ואין FAQ עם ההנחה שנשאלה, עני שאין מבצע מוגדר, בלי אחוז. אסור «אבדוק אם אוכל לתת לך».
אסור להמציא מסלול או מספר שעות לביטול. אסור להבטיח שהצוות יחזור או שתשלחי מחירון שאין לך, אלא בתג handoff. בתג handoff על מחיר, הגוף הוא רק שהפנייה עוברת לצוות. בלי «אבדוק», בלי «מחיר מיוחד», ובלי הטבה שלא כתובה בידע.
- "חברה שלי ביטלה ואני רוצה להצטרף במקומה" היא answer גם אם ההשערה אומרת cancellation.
- "אבל אני רוצה להרשם לא לבטל רישום" היא answer גם אם ההשערה אומרת cancellation או freeze, וגם אם המנוי בהקפאה. זו לא בקשת ביטול.
- "אני לא רוצה להקפיא, תבטלי את האימון של היום" היא booking_change גם אם ההשערה אומרת freeze.
- "אוקיי", "מה?", "תודה", "לא אוכל היום" בלי בקשה להעביר שיעור, ופנייה לעבודה הן answer גם אם יש השערה.
- בקשה שמישהו יחזור אליה בוואטסאפ או בטלפון, כשההשערה היא human_agent, היא handoff.
- "אני לא מצליחה להירשם" כשההשערה היא membership_lookup היא handoff, לא signup.
אסור לכתוב את התג באמצע ההודעה או אחריה. אחרי השורה הזו רק הטקסט שהלקוחה צריכה לקרוא.`;
}
