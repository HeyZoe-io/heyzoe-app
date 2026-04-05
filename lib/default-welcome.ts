/** טמפלייט ברירת מחדל למסלול מכירה — מסונכרן עם מסך ההגדרות ועם פרומפט זואי */

export type ServiceLike = { name: string };

const TRAINING_HINT =
  /יוגה|פילאטיס|כושר|אימון|אקרו|crossfit|trx|סטודיו|ספורט|ריקוד|ריצה|מאמן|התעמלות|פונקציונלי/i;

function isTrainingContext(niche: string, serviceNames: string[]): boolean {
  if (TRAINING_HINT.test(niche.trim())) return true;
  return serviceNames.some((s) => TRAINING_HINT.test(s));
}

function openingSalutation(vibeLabels: string[]): string {
  const v = new Set(vibeLabels);
  if (v.has("יוקרתי") || v.has("מקצועי")) return "שלום,";
  if (v.has("רוחני")) return "שלום לך,";
  if (v.has("חברי") || v.has("מצחיק")) return "היי!";
  if (v.has("ישיר")) return "היי,";
  return "היי!";
}

export function buildDefaultSaleWelcome(params: {
  botName: string;
  businessName: string;
  address: string;
  services: ServiceLike[];
  niche?: string;
  vibeLabels?: string[];
}): { intro: string; question: string; options: string[] } {
  const bot = params.botName.trim() || "זואי";
  const rawBiz = params.businessName.trim() || "העסק";
  const biz = rawBiz.replace(/!+$/g, "").trim();
  const addr = params.address.trim();
  const names = params.services.map((s) => s.name.trim()).filter(Boolean);
  const vibes = Array.isArray(params.vibeLabels) ? params.vibeLabels : [];
  const training = isTrainingContext(params.niche ?? "", names);

  const sal = openingSalutation(vibes);
  const line1 = `${sal} כאן ${bot} מ־${biz}!`;
  const line2 = addr ? `אנחנו יושבים ב־${addr}.` : "";
  const intro = [line1, line2].filter(Boolean).join("\n");

  const question =
    names.length >= 2
      ? training
        ? "אשמח להבין ראשית איזה מהאימונים מעניין אותך?"
        : "אשמח להבין ראשית איזה מהשירותים מעניין אותך?"
      : training
        ? "אשמח להבין ראשית איזה אימון מעניין אותך?"
        : "אשמח להבין ראשית מה מעניין אותך?";

  let options: string[];
  if (names.length >= 2) {
    options = names.slice(0, 5);
  } else if (names.length === 1) {
    options = [names[0], "משהו אחר"];
  } else {
    options = ["לא יצא לי", "יצא לי פעם-פעמיים", "יצא לי לא מעט פעמים"];
  }

  return { intro, question, options };
}
