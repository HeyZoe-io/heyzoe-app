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

function morningIdleBody(vibes: string[], bot: string, biz: string, trial: string, hasLink: boolean): string {
  const v = new Set(vibes);
  const linkHint = hasLink
    ? ` אם תרצו — אפשר גם לבחור שעה מהמערכת, ואני כאן לכל שאלה בדרך.`
    : "";
  if (v.has("ישיר")) {
    return `בוקר טוב, ${bot} מ־${biz}.

עדיין רלוונטי לכם ${trial}? ענו כאן ונסגור את זה מהר.${linkHint}`;
  }
  if (v.has("יוקרתי") || v.has("מקצועי") || v.has("סמכותי")) {
    return `בוקר טוב 🙂

${bot} מ־${biz}. נגענו אתמול — רצינו לבדוק בעדינות אם נשאר משהו פתוח, או אם תרצו לקבוע ${trial}.${linkHint}

נשמח לסייע.`;
  }
  if (v.has("מצחיק")) {
    return `בוקר טוב 🙂 ${bot} כאן מ־${biz}!

אם אתמול נשאר באמצע — אין בעיה. רוצים לשריין ${trial} או סתם לשאול משהו? אני פה.${linkHint}`;
  }
  if (v.has("רוחני")) {
    return `בוקר טוב ושקט 🙂

${bot} מ־${biz}. אם תרצו להמשיך את הדרך אלינו — ${trial} או כל שאלה — אני כאן איתכם.${linkHint}`;
  }
  return `בוקר טוב 🙂 ${bot} מ־${biz}.

נגענו אתמול ורצינו לבדוק אם נשאר משהו פתוח — או אם בא לכם לקבוע ${trial}.${linkHint}

כתבו כאן בקצרה ואשמח להמשיך מכאן.`;
}

/** טקסט ברירת מחדל להודעת הפולואפ האוטומטית בווטסאפ (למחרת בבוקר). */
export function buildDefaultWhatsAppIdleFollowup(input: DefaultFollowupInput): string {
  const bot = input.botName.trim() || "זואי";
  const biz = input.businessName.trim() || "העסק";
  const trial = trialLabel(input.serviceNames, input.niche);
  return morningIdleBody(input.vibeLabels ?? [], bot, biz, trial, input.hasBookingLink);
}

