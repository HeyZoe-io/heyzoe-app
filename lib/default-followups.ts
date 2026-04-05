/**
 * טקסטי פולואפ ברירת מחדל — מותאמים לשם בוט, עסק, נישה, סגנון דיבור ושירותים.
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

function openingCongrats(vibes: string[]): string {
  const v = new Set(vibes);
  if (v.has("יוקרתי")) return "ברוכים הבאים";
  if (v.has("מצחיק")) return "יאללה, זה קרה";
  if (v.has("רוחני")) return "איזה כיף שבחרתם להצטרף";
  if (v.has("מקצועי")) return "תודה על ההרשמה";
  if (v.has("ישיר")) return "נרשמתם";
  return "כל הכבוד";
}

function reminderTone(vibes: string[]): string {
  const v = new Set(vibes);
  if (v.has("ישיר")) return "עדיין רוצים לשריין? ענו כאן.";
  if (v.has("יוקרתי")) return "בעדינות — אם תרצו לשריין מקום, נשמח לסייע כאן.";
  return "רק מזכירה בעדינות — אם תרצו לשריין מקום, אפשר לענות בקצרה כאן 🙂";
}

export function buildDefaultFollowupPack(input: DefaultFollowupInput): {
  followupAfterRegistration: string;
  followupAfterHourNoRegistration: string;
  followupDayAfterTrial: string;
} {
  const bot = input.botName.trim() || "זואי";
  const biz = input.businessName.trim() || "העסק";
  const trial = trialLabel(input.serviceNames, input.niche);
  const firstSvc = input.serviceNames[0]?.trim() ?? "";
  const addr = input.address.trim();
  const tag = input.tagline.trim();
  const vibes = input.vibeLabels ?? [];

  const head = `${openingCongrats(vibes)}! נרשמתם בהצלחה 🎉

${bot} כאן מ־${biz}.${tag ? ` ${tag}` : ""}

לפני ה${trial}:
• להגיע כמה דקות לפני
• בגדים נוחים
• מומלץ לשתות מים לפני`;

  const foot = addr ? `\n\n📍 ${addr}\n\nנתראה בקרוב!` : `\n\nנתראה בקרוב!`;

  const followupAfterRegistration = `${head}${foot}`;

  const linkBit = input.hasBookingLink
    ? `\n\nיש גם קישור לשעות/הרשמה — ${bot} כאן לכל שאלה בדרך.`
    : "";

  const followupAfterHourNoRegistration = `היי, ${bot} מ־${biz}.

${reminderTone(vibes)}${linkBit}`;

  const svcBit = firstSvc ? ` (${firstSvc})` : "";
  const followupDayAfterTrial = `היי! איך היה לכם ה${trial}?${svcBit}

${bot} אשמח לשמוע במילה–שתיים — ואז נציע את מה שמתאים לכם ב־${biz} להמשך.`;

  return {
    followupAfterRegistration,
    followupAfterHourNoRegistration,
    followupDayAfterTrial,
  };
}
