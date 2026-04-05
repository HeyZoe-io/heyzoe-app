/** טמפלייט ברירת מחדל למסלול מכירה — מסונכרן עם מסך ההגדרות ועם פרומפט זואי */

export type ServiceLike = { name: string };

const TRAINING_HINT =
  /יוגה|פילאטיס|כושר|אימון|אקרו|crossfit|trx|סטודיו|ספורט|ריקוד|ריצה|מאמן|התעמלות|פונקציונלי/i;

function isTrainingContext(niche: string, serviceNames: string[]): boolean {
  if (TRAINING_HINT.test(niche.trim())) return true;
  return serviceNames.some((s) => TRAINING_HINT.test(s));
}

/** שורת תיאור אחרי «כאן ___ מ־___» — תגית, או מאפיינים מחוברים */
function descriptionFromProfile(tagline: string, traits: string[]): string {
  const t = tagline.trim();
  if (t) return t;
  const parts = traits.map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return "";
  return parts.join(". ");
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
  /** תגית העסק (שלב 1) */
  tagline?: string;
  /** עד שלושה מאפיינים (שלב 1) */
  traits?: string[];
}): { intro: string; question: string; options: string[] } {
  const bot = params.botName.trim() || "זואי";
  const rawBiz = params.businessName.trim() || "העסק";
  const biz = rawBiz.replace(/!+$/g, "").trim();
  const addr = params.address.trim();
  const names = params.services.map((s) => s.name.trim()).filter(Boolean);
  const vibes = Array.isArray(params.vibeLabels) ? params.vibeLabels : [];
  const training = isTrainingContext(params.niche ?? "", names);
  const traitsArr = Array.isArray(params.traits) ? params.traits : [];
  const descLine = descriptionFromProfile(params.tagline ?? "", traitsArr);

  const sal = openingSalutation(vibes);
  const line1 = `${sal} כאן ${bot} מ־${biz}!`;
  const lineAddr = addr ? `אנחנו יושבים ב־${addr}.` : "";
  const intro = [line1, descLine, lineAddr].filter(Boolean).join("\n");

  if (names.length === 1) {
    const svc = names[0];
    const question = `האם יצא לך לנסות ${svc} בעבר?`;
    const options = ["עוד לא :)", "פעם פעמיים...", "כן! יצא לי לא מעט!"];
    return { intro, question, options };
  }

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
  } else {
    options = ["לא יצא לי", "יצא לי פעם-פעמיים", "יצא לי לא מעט פעמים"];
  }

  return { intro, question, options };
}
