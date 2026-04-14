/**
 * טקסט פולואפ ווטסאפ אוטומטי (ליד שאינו מגיב) — מותאם לשם בוט, עסק, נישה וסגנון דיבור.
 * הודעה אחת בלבד ליום למחרת בבוקר (לפי סליחוס בשרת).
 */

export type DefaultFollowupInput = {
  botName: string;
  businessName: string;
  niche: string;
  vibeLabels: string[];
  serviceNames: string[];
  address: string;
  tagline: string;
  hasBookingLink: boolean;
};

function trialLabel(serviceNames: string[], niche: string): string {
  const n = niche.toLowerCase();
  const joined = `${n} ${serviceNames.join(" ")}`.toLowerCase();
  if (/יוגה|פילאטיס|אימון|כושר|סטודיו|אקרו|trx|ריקוד/.test(joined)) {
    return "שיעור הניסיון";
  }
  if (/קליניק|טיפול|ייעוץ|רפואה|פסיכולוג/.test(joined)) {
    return "פגישת ההיכרות";
  }
  if (serviceNames[0]?.trim()) {
    return `המפגש הראשון (${serviceNames[0].trim()})`;
  }
  return "שיעור הניסיון";
}

function morningIdleBody(vibes: string[], bot: string, biz: string, _trial: string, _hasLink: boolean): string {
  const v = new Set(vibes);
  const isFormal = v.has("יוקרתי") || v.has("מקצועי") || v.has("סמכותי");
  const isDirect = v.has("ישיר");

  // Keep followup short + consistent (per product decision).
  if (isFormal) {
    return `בוקר טוב 🙂 ${bot} מ־${biz}.

רציתי לבדוק אם יש שאלות נוספות, או שתרצו להמשיך לרכישת אימון הניסיון דרך הכפתור ולבחור מועד מתאים.

אני כאן לכל שאלה.`;
  }
  if (isDirect) {
    return `בוקר טוב, ${bot} מ־${biz}.

דיברנו אתמול — יש שאלות? אפשר להמשיך דרך הכפתור לרכישת אימון הניסיון ולבחור מועד.

אני כאן.`;
  }
  return `בוקר טוב 🙂 ${bot} מ־${biz}.

קשקשנו אתמול — יש שאלות? אפשר להמשיך דרך הכפתור לרכישת אימון הניסיון ולבחור מועד.

אני כאן לכל שאלה.`;
}

/** טקסט ברירת מחדל להודעת הפולואפ האוטומטית בווטסאפ (למחרת בבוקר). */
export function buildDefaultWhatsAppIdleFollowup(input: DefaultFollowupInput): string {
  const bot = input.botName.trim() || "זואי";
  const biz = input.businessName.trim() || "העסק";
  const trial = trialLabel(input.serviceNames, input.niche);
  return morningIdleBody(input.vibeLabels ?? [], bot, biz, trial, input.hasBookingLink);
}

