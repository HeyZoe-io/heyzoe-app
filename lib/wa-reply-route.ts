import { buildClosedPlaybookDefaultReply } from "@/lib/wa-closed-playbook-copy";
import { lookupPlaybookFact } from "@/lib/wa-closed-playbook-facts";
import type { ClosedPlaybookKnowledge } from "@/lib/wa-closed-playbook-types";

/**
 * Intent tag on a free-text WhatsApp reply. Same Claude/Gemini call, no extra request.
 * Routing lives in code. The tag is stripped before the lead sees the text.
 */
export const WA_REPLY_ROUTES = [
  "answer",
  "schedule",
  "booking_change",
  "booking_change_trial",
  "class_move",
  "class_move_member",
  "class_move_trial",
  "handoff",
  "signup",
  "interest",
  "member_or_trial_unclear",
  "policy_question",
  "personal",
  "registration_check",
  "my_schedule",
  "membership_purchase",
] as const;

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
  | { kind: "class_move" }
  | { kind: "class_move_member" }
  | { kind: "class_move_trial" }
  | { kind: "handoff" }
  | { kind: "membership_purchase" };

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
    if (
      name === "interest" ||
      name === "signup" ||
      name === "personal" ||
      name === "class_move" ||
      name === "class_move_member" ||
      name === "class_move_trial" ||
      name === "booking_change_trial" ||
      name === "registration_check" ||
      name === "my_schedule" ||
      name === "schedule" ||
      name === "membership_purchase"
    ) {
      return { route: name, body: "", tagStatus: "ok" };
    }
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
  if (input.extracted.route === "booking_change" || input.extracted.route === "booking_change_trial") {
    return { kind: "booking_change" };
  }
  if (input.extracted.route === "class_move") return { kind: "class_move" };
  if (input.extracted.route === "class_move_member") return { kind: "class_move_member" };
  if (input.extracted.route === "class_move_trial") return { kind: "class_move_trial" };
  if (input.extracted.route === "handoff") return { kind: "handoff" };
  if (input.extracted.route === "membership_purchase") return { kind: "membership_purchase" };
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
- answer - תשובה למי שכבר בפלואו, או למנוייה ששואלת על מה שכבר יש לה, או שאלה שלא נועדה להצטרף: ציוד, ברכה, מי מנהל, שעות פתיחה. למנוייה קיימת (מהשיחה, או מנוייה בארבוקס) אין שיווק ואין הזמנה להגיע. לידה שאינה מנוייה ומבקשת מידע, מחיר, או מיקום כדי לשקול להצטרף היא interest, לא answer. מדיניות ביטול, הקפאה או החזר אינה answer.
- schedule - הלקוחה שואלת אילו שיעורים או שעות קיימים בלוח, בלי לבקש לשנות שיבוץ שלה.
- booking_change - הלקוחה רוצה לבטל שיעור שהיא כבר רשומה אליו, בלי לבקש מועד אחר, וזה לא אימון ניסיון. שעה שהיא מציינת בתוך בקשת הביטול היא השיעור לביטול, לא שאלה מה יש בלוח.
- booking_change_trial - אותו ביטול כמו booking_change, והשיעור הוא אימון ניסיון שכבר קיים. זה יכול להיות כתוב בהודעה, או ברור מההודעות האחרונות, גם אם המילה ניסיון לא חוזרת עכשיו. בקשה לקבוע אימון ניסיון חדש היא signup, לא booking_change_trial.
- class_move - הלקוחה רוצה להעביר אימון מיום ליום אחר. שעה בתוך הבקשה היא היעד החדש, לא שאלה על הלוח. אם באותה הודעה עדיין לא ברור אם יש לה מנוי או שזה אימון ניסיון — class_move. אם כבר ברור שיש מנוי או כרטיסייה — class_move_member. אם כבר ברור שזה אימון ניסיון שקיים, או שההודעות האחרונות כבר הראו שזה אימון הניסיון שלה — class_move_trial. «אני רשומה לשעה X ורוצה לבוא בשעה Y» באותו היום היא booking_change, לא class_move, ו-booking_change_trial אם זה אימון הניסיון. ביטול בלי מועד אחר, וביטול מאוחר שצריך לבטל, נשארים booking_change או booking_change_trial. בקשה לקבוע אימון ניסיון חדש היא signup, לא class_move. אם האפליקציה כבר לא נתנה לה לשנות — handoff, לא class_move.
- class_move_member - יש לה מנוי קיים (או כרטיסייה), והיא מבקשת להעביר אימון מיום ליום. תשובה לשאלה «מנוי קיים או אימון ניסיון» בלי בקשה להעביר אימון אינה class_move.
- class_move_trial - מדובר באימון ניסיון שכבר קיים, והיא מבקשת להעביר אותו ליום אחר. תשובה לשאלה «מנוי קיים או אימון ניסיון» בלי בקשה להעביר אימון אינה class_move.
- handoff - בקשה שהצוות יבצע פעולה: תלונה, החזר בפועל, ביטול מנוי, הקפאה בפועל, כאב או מגבלה בגוף, בקשה מפורשת לנציג, או בקשה אישית להנחה או למחיר אחר. שאלה מה לעשות עם כאב או פציעה היא handoff, גם כשהיא נשמעת כמו שאלה רגילה.
- policy_question - שאלה על הכלל עצמו, בלי לבקש לבצע אותו עכשיו: כמה זמן מראש מבטלים שיעור, מה כללי ההקפאה, מה תנאי ההחזר. אסור לכתוב מספר, אחוז, או כלל שלא כתובים בידע.
- signup - היא כבר החליטה להירשם או לקבוע אימון ניסיון: איך נרשמים, היא רוצה להירשם, או שקבעה להגיע לניסיון. זה signup גם אם ההשערה אומרת שאין לה מנוי. בקשת מידע כללית אינה signup.
- interest - לידה שעוד לא בפלואו המכירה, והיא לא מנוייה, ומביעה עניין בשירות: מבקשת מידע או פרטים, שואלת על סוגי אימונים, משך, מחיר או מיקום כדי לשקול להצטרף, או עונה למודעה. signup = כבר החליטה להירשם. interest = רוצה לשמוע עוד. מנוייה אינה interest. שאלה על כלל (חלון ביטול, הקפאה, החזר) נשארת policy_question גם מלידה חדשה.
- personal - הודעה אל הבעלים או המאמנת כאדם, לא אל שירות הסטודיו. פנייה בכינוי חיבה (אהובה, מאמי, מותק, נשמה, יקירה) או בשם לבדה אינה מספיקה. צריך גם סימן יחס: משהו שנאמר מחוץ לצ'אט (אמרת לי, דיברנו, לא הגעתי, ביקשתי ממך, כמו שסיכמנו), עדכון אישי שמופנה אליה, או שאלה אישית עליה (מתי את חוזרת). «היי אהובה» לבד היא answer. תשובה קצרה (כן, לא, סבבה, אימוג'י) להצעה שהבעלים שלחו ידנית בהודעה האחרונה היא personal והגוף ריק, לא booking_change. הגוף ריק. אם יש גם בקשת שירות (לבטל, להעביר, החזר), תייגי לפי בקשת השירות ולא personal.
- registration_check - היא בודקת שההרשמה שלה לשיעור או לאימון קיימת, בלי לבקש לשנות, לבטל או להזיז. «אני רק רוצה לוודא» לבד אינו registration_check. וידוא על מנוי, חיוב, הפסקת מנוי או ביטול מנוי אינו registration_check — זה handoff. «אני רשומה» בתוך בקשה להחליף שעה אינה registration_check.
- my_schedule - היא שואלת מתי השיעור שהיא עצמה כבר קבעה, לא מה יש בלוח הכללי.
- membership_purchase - היא רוצה עכשיו לקנות, לחדש או לשלם על מנוי או כרטיסייה, לעצמה או לבן משפחה: לעשות מנוי, להסדיר תשלום על מנוי, לקנות כרטיסייה, איך משלמים על המנוי. לפי הכוונה, לא לפי מילה. שאלה כמה עולה בלי כוונה לקנות עכשיו היא interest או answer. אימון ניסיון הוא signup. בעיה בחיוב, עדכון אמצעי תשלום, החזר, הנחה או מחיר אחר הם handoff. הגוף ריק.
- member_or_trial_unclear - לא ברור אם היא כבר חברה. הרשמה נכשלה או «נרשמתי ולא עובד», בלי הפניה, בלי שיעור שהיא רוצה להתחיל, ובלי שאלה על עלות כדי להצטרף.

דוגמאות answer:
- מנוייה קיימת: "מה שעות הפתיחה?" -> [[route:answer]]
- מנוייה קיימת: "כמה עולה הכרטיסייה שלי?" -> [[route:answer]]
- באמצע הפלואו, אחרי שהאימונים כבר הוצגו: "כמה עולה?" -> [[route:answer]]
- "מי מנהל את הסטודיו?" -> [[route:answer]]
- "צריך להביא מזרן?" -> [[route:answer]]
- "תודה רבה" -> [[route:answer]]
דוגמאות schedule:
- "מערכת שעות" -> [[route:schedule]]
- "מה יש ביום שני בבוקר?" -> [[route:schedule]]
- "יש שיעורים אחרי 18:00?" -> [[route:schedule]]
- "מתי יש פילאטיס השבוע?" -> [[route:schedule]]
- "מתי מתקיימים שיעורי עיצוב וחיטוב?" -> [[route:schedule]]
בתג schedule, ימים ושעות רק אם הם מופיעים במועדי הלוח בידע. אסור להמציא, להעריך או להכליל שעה. אם השיעור או היום לא בידע, אמרי את זה בקצרה והציעי מה כן קיים. שאלה «על איזה יום» רק כשהשאלה לא מציינת יום והלוח ארוך מדי להודעה אחת.
דוגמאות booking_change (ביטול, גם כשיש בהן שעה):
- "אני רשומה לחמש וחצי ואני רוצה לבוא בשש וחצי" -> [[route:booking_change]]
- "נרשמתי בטעות ל-18:00, רציתי את השיעור של 19:30" -> [[route:booking_change]]
- "ביום שישי נרשמתי לרשימת המתנה לשני אימונים, ביטלתי אחד ונרשם ביטול מאוחר שצריך לבטל" -> [[route:booking_change]]
- "אני לא מצליחה לבטל באפליקציה את השיעור של מחר ב-19:00" -> [[route:booking_change]]
- "לא אגיע מחר, אפשר לבטל?" -> [[route:booking_change]]
- "תורידו אותי מהרשימה של חמישי ב-17:00" -> [[route:booking_change]]
- "יש אפשרות לבטל את השיעור נסיון? שמתי לב שהזמנים של השיעורים לא מתאימים לי" -> [[route:booking_change_trial]]
דוגמאות class_move (העברה מיום ליום, גם כשיש שעה):
- "אפשר להזיז אותי מחמישי לשני ב-8:30?" -> [[route:class_move]]
- "תמחקו אותי מהשיעור ותעבירו אותי ליום שני" -> [[route:class_move]]
- "נרשמתי לשיעור הלא נכון, תסדרו לי לשני בבוקר" -> [[route:class_move]]
- "השעה שקבעתי לא מסתדרת, יש מצב למצוא לי משהו אחר?" -> [[route:class_move]]
- "אפשר להחליף לי את השיעור של ראשון לשלישי?" -> [[route:class_move]]
- "יש לי מנוי, המועד שלי לא נוח, אפשר מחר?" -> [[route:class_move_member]]
- "זה אימון הניסיון שלי והיום לא אגיע, אפשר יום אחר?" -> [[route:class_move_trial]]
תשובה קצרה לשאלה אם יש מנוי או אימון ניסיון, בלי בקשה להעביר אימון, אינה class_move. class_move רק כשהיא מבקשת להעביר אימון.
דוגמאות handoff:
- "אני רוצה לדבר עם המנהלת" -> [[route:handoff]]
- "יש לי תלונה על השיעור" -> [[route:handoff]]
- "אני רוצה החזר" -> [[route:handoff]]
- "אני רוצה לבטל את המנוי" -> [[route:handoff]]
- "תקפיאי לי את המנוי" -> [[route:handoff]]
- "תעשי לי הנחה" -> [[route:handoff]]
- "אם אביא חברה אפשר מחיר לזוג?" -> [[route:handoff]]
רצון להיות נציג, או מחמאה על נציג, אינה handoff.
- "סיימתי קורס ואשמח להיות נציג" -> [[route:answer]]
- "הנציג שלכם היה מעולה" -> [[route:answer]]
דוגמאות policy_question:
- "כמה זמן לפני ניתן לבטל שיעור?" -> [[route:policy_question]]
- "מה כללי ההקפאה?" -> [[route:policy_question]]
- "מה מדיניות ההחזר?" -> [[route:policy_question]]
דוגמאות interest (לידה חדשה, לפני שהפלואו נפתח):
- "שלום! אפשר לקבל מידע נוסף על זה?" -> [[route:interest]]
- "היי אשמח לשמוע מידע" -> [[route:interest]]
- "פרטים?" -> [[route:interest]]
- "אשמח לשמוע על האימונים" -> [[route:interest]] והגוף ריק
- "כמה עולה?" -> [[route:interest]] והגוף הוא פירוט המחירים מהידע, בלי שאלה ובלי תפריט
- "איפה אתם נמצאים ומה יש?" -> [[route:interest]] והגוף משפט אחד עם הכתובת מהידע, בלי מחיר ובלי תפריט
- "אני רוצה להתחיל להגיע לשיעורים, מה העלויות?" -> [[route:interest]] והגוף רק פירוט המחירים מהידע
- "אשמח לשמוע פרטים על האימונים סוגים משך זמן מחיר ומיקום" -> [[route:interest]] והגוף עונה על משך, מחיר ומיקום מהידע, בלי תפריט
דוגמאות personal (הגוף ריק):
- "היי אהובה שבוע הבא לא הגעתי כי אמרת לי שלא תהיי" -> [[route:personal]]
- "מאמי לא אגיע מחר, דיברנו" -> [[route:personal]]
- "תודה על השיחה אתמול אהובה" -> [[route:personal]]
- "את חוזרת מחו\"ל מתי?" -> [[route:personal]]
- "כמו שאמרת לי, אני מחכה עם התשלום לחודש הבא" -> [[route:personal]]
- "יקירה ראיתי את הסטורי שלך, מהממת" -> [[route:personal]]
דוגמאות שאינן personal:
- "לא אגיע מחר, אפשר לבטל?" -> [[route:booking_change]]
- "מאמי כמה עולה מנוי?" -> [[route:interest]] והגוף הוא המחיר מהידע, בלי החלק האישי
- "דיברנו בטלפון ואמרו לי שיש שיעור ניסיון, איך נרשמים?" -> [[route:signup]]
- "השיעור של אתמול היה מעולה, מתי הבא?" -> [[route:schedule]]
- "אהובה אמרת לי שלא תהיי, אז אפשר לבטל את השיעור של מחר?" -> [[route:booking_change]] והגוף רק על הביטול, בלי לאשר או להכחיש את מה שנאמר מחוץ לצ'אט
- "יקירה תודה על אתמול, וכמה עולה המנוי?" -> [[route:interest]] והגוף רק על המחיר מהידע, בלי החלק האישי
דוגמאות signup:
- "איך נרשמים לשיעור ניסיון?" -> [[route:signup]]
- "אשמח להגיע לשיעור ניסיון" -> [[route:signup]]
- "היי, לא, אשמח להגיע בשישי לשיעור נסיון, ולא עלה באפשרויות" -> [[route:signup]]
- "אשמח על פרטים ומה העלות כדי להצטרף" -> [[route:signup]] והגוף הוא פירוט המחיר מהידע, בלי תפריט
- "היי אני שירה, אורית הפנתה אותי, אשמח ליוגה ביום שני בערב ומה העלות" -> [[route:signup]] והגוף רק על המחיר מהידע
דוגמאות membership_purchase (הגוף ריק):
- "ערב טוב, רוצה להסדיר תשלום עבור הבת שלי" -> [[route:membership_purchase]]
- "אני רוצה לעשות מנוי" -> [[route:membership_purchase]]
- "איך אני קונה כרטיסייה?" -> [[route:membership_purchase]]
- "נגמר לי המנוי, אפשר לחדש?" -> [[route:membership_purchase]]
- "היה לי אימון ניסיון מעולה, אני רוצה להמשיך פעם בשבוע" -> [[route:membership_purchase]]
דוגמאות שאינן membership_purchase:
- "כמה עולה מנוי?" -> [[route:interest]]
- "החיוב שלי נכשל" -> [[route:handoff]]
- "אפשר מחיר מיוחד על מנוי שנתי?" -> [[route:handoff]]
דוגמאות member_or_trial_unclear:
- "נרשמתי ולא עובד" -> [[route:member_or_trial_unclear]]
- "לא מצליחה להירשם" בלי סימן שהיא חדשה -> [[route:member_or_trial_unclear]]
אם מופיעה שורה Possible intent detected by keyword, זו השערה בלבד ולא עובדה. ברירת המחדל היא answer. השערה לא גוברת על מסלול ברור.
תייגי handoff אם ההשערה עצמה היא מה שהלקוחה מבקשת עכשיו: ביטול מנוי, הקפאה, החזר, נציג, בדיקת מנוי, או מתי נקבע השיעור שלה. תייגי handoff גם בלי השערה כשהבקשה היא הנחה אישית, מחיר אחר, מחיר לזוג, או מחיר לחברה.
תייגי booking_change כשהיא מבקשת לבטל שיעור אחד שהיא כבר רשומה אליו, בלי מועד חלופי, וההשערה היא על השיעור ולא על המנוי. אם השיעור הוא אימון ניסיון שכבר קיים, מההודעה או מההודעות האחרונות, תייגי booking_change_trial. גם «אני רשומה לשעה ואני רוצה שעה אחרת באותו היום» וגם ביטול מאוחר שצריך לבטל הם booking_change, לא schedule ולא class_move, ו-booking_change_trial כשזה אימון הניסיון. תייגי class_move אם היא מבקשת להעביר מיום ליום אחר, גם כשההשערה אומרת reschedule או class_cancel, ו-class_move_trial כשזה אימון הניסיון.
תייגי interest כשלידה חדשה רוצה לשמוע עוד, גם אם המשפט לא זהה לטריגר שמור. תייגי signup רק כשהיא כבר החליטה להירשם או לקבוע ניסיון, גם אם ההשערה אומרת registration_no_member.
אם היא כבר באמצע הפלואו, שאלה על מחיר או פרט היא answer, לא interest ולא signup. אם כתוב שהיא לא באמצע הפלואו, היסטוריה ישנה לא הופכת בקשת מידע ל-answer.
אסור לאשר, להכחיש, לפרש או להתנצל על משהו שנאמר או סוכם מחוץ לצ'אט הזה. אסור לדבר בגוף ראשון על המעשים, הלוח, ההיעדרות או אמירות העבר של הבעלים. אם לא בטוח שההודעה אישית, תייגי personal.
למנוייה אין משפטי מכירה: אסור «האימונים שלנו מתאימים לכל גוף» ואסור «מוזמנת להגיע». interest רק למי שאינה מנוייה.
בתג interest, בקשה שהיא רק לשמוע על האימונים: הגוף ריק. אם יש שאלה נוספת (מחיר, מיקום, משך, למי מתאים, מה להביא, חניה), הגוף הוא התשובה מהידע לשאלה הזו. מותר מחיר, כתובת או משך אם נשאלו והם כתובים בידע. אסור בגוף: «רוצה שנמצא», קריאה לפעולה, אפשרויות ממוספרות, או תפריט. בתג signup הגוף ריק, חוץ מתשובה קצרה לשאלה נוספת כזו.
תייגי member_or_trial_unclear רק כשאי אפשר לדעת אם יש לה מנוי. «אני לא מצליחה להירשם» כשההשערה היא membership_lookup היא handoff, לא signup.
מילה מההשערה בתוך בקשה אחרת אינה אישור.
אסור לכתוב אחוז, הנחה, או מבצע שלא כתובים בשדה «הנחות ומבצעים» או בתשובת FAQ. אם השדה מלא, «יש מבצע?» היא answer שמצטטת אותו. אם השדה הוא «לא הוגדר» ואין FAQ עם ההנחה שנשאלה, עני שאין מבצע מוגדר, בלי אחוז. אסור «אבדוק אם אוכל לתת לך».
אסור להמציא מסלול או מספר שעות לביטול. אסור להבטיח שהצוות יחזור או שתשלחי מחירון שאין לך, אלא בתג handoff או policy_question. בתג handoff על מחיר, הגוף הוא רק שהפנייה עוברת לצוות. בלי «אבדוק», בלי «מחיר מיוחד», ובלי הטבה שלא כתובה בידע.
שאלה על כלל היא policy_question גם אם ההשערה היא class_cancel, freeze, או refund. בקשה לבצע את הביטול, ההקפאה, או ההחזר היא handoff.
- "חברה שלי ביטלה ואני רוצה להצטרף במקומה" היא answer גם אם ההשערה אומרת cancellation.
- "אבל אני רוצה להרשם לא לבטל רישום" היא answer גם אם ההשערה אומרת cancellation או freeze, וגם אם המנוי בהקפאה. זו לא בקשת ביטול.
- "אני לא רוצה להקפיא, תבטלי את האימון של היום" היא booking_change גם אם ההשערה אומרת freeze.
- "אני לא רוצה להקפיא, תעבירי את האימון של היום למחר" היא class_move גם אם ההשערה אומרת freeze.
- "אוקיי", "מה?", "תודה", "לא אוכל היום" בלי בקשה להעביר שיעור, ופנייה לעבודה הן answer גם אם יש השערה.
- בקשה שמישהו יחזור אליה בוואטסאפ או בטלפון, כשההשערה היא human_agent, היא handoff.
- "אני לא מצליחה להירשם" כשההשערה היא membership_lookup היא handoff, לא signup.
- "אני רשומה לחמש וחצי ואני רוצה לבוא בשש וחצי" היא booking_change. "אני רשום לשעה 19:30 ואני רוצה להעביר לשעה 17:30" היא booking_change. אותו יום ושעה אחרת אינם class_move. יום אחר הוא class_move.
- סיפור על רשימת המתנה, ביטול, וביטול מאוחר שצריך לבטל הוא booking_change, לא schedule. «לשני אימונים» הוא המספר שתיים, לא יום שלישי. «נרשמתי» בתוך הסיפור הזה אינו שאלה מה יש בלוח.
- "אני רשומה לשיעור של מחר?" בלי בקשה לשנות היא registration_check.
- "אני רק רוצה לוודא שבקשת הפסקת המנוי ברורה ושלא יהיה חיוב" היא handoff, לא registration_check.
- "אני רק רוצה לוודא" בלי שיעור או אימון אינה registration_check.
- "מתי האימון שלי?" היא my_schedule. "מתי מתקיימים השיעורים?" ו"מתי מתקיימים שיעורי עיצוב וחיטוב?" הן schedule.
- "מערכת שעות" לבדה, וגם «אפשר לקבל מערכת שעות של השבוע?», הן schedule.
- הודעה שהיא רק מספר טלפון, כשההשערה היא schedule_lookup, היא my_schedule.
- "קניתי כרטיסייה ולא נותן לי להירשם" היא handoff, לא member_or_trial_unclear.
- ב-interest הגוף ריק כשהבקשה היא רק לשמוע על האימונים. כשיש שאלה נוספת, מותר לנקוב רק בעובדה שנשאלה וכתובה בידע. אסור להמציא מחיר. אסור לכתוב «רוצה שנמצא».
- ב-signup הגוף ריק, חוץ מתשובה קצרה לשאלה נוספת על מחיר, מיקום או משך.
- בשאלת מדיניות אסור לאשר מספר ימים או שעות אם המספר לא כתוב בידע.
אסור לכתוב את התג באמצע ההודעה או אחריה. אחרי השורה הזו רק הטקסט שהלקוחה צריכה לקרוא.
אם כבר נשלחה תשובה על אותו עניין, אל תחזרי על אותה פסקה. המשך קצר בלי שאלה חדשה (דאגה או תנאי) הוא answer עם משפט אחד מההקשר, בלי «יש עוד משהו». דוגמה: אחרי שהגיל מתחת לטווח והעברת לצוות, «שלא יהיה נזק כלשהו» -> [[route:answer]] «כמובן, חשוב לבדוק». «מצוין תודה רבה» אחרי העברה לצוות אינו handoff. אסור «למצטערי». נכון «לצערי».`;
}
