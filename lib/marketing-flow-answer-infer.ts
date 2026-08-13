import { normalizeMarketingInboundText } from "@/lib/marketing-whatsapp";

const HE_STOPWORDS = new Set([
  "אבל",
  "רגע",
  "שלא",
  "נבזבז",
  "לך",
  "את",
  "הזמן",
  "יש",
  "ה",
  "של",
  "עם",
  "על",
  "זה",
  "מה",
  "אם",
  "או",
  "גם",
  "לא",
  "כי",
  "כל",
  "אני",
  "אנחנו",
  "הוא",
  "היא",
  "הם",
  "הן",
  "לי",
  "לנו",
  "אתם",
  "אתן",
  "עוד",
  "רק",
  "כבר",
  "מאוד",
  "כך",
  "כזה",
  "כזאת",
  "האם",
  "בשביל",
]);

function tokenizeHe(text: string): string[] {
  return normalizeMarketingInboundText(text)
    .toLowerCase()
    .replace(/[\\/|,;:!?…·•\-–—()[\]{}'"״׳]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function stripChoicePunct(text: string): string {
  return normalizeMarketingInboundText(text)
    .toLowerCase()
    .replace(/[!?.…]+$/gu, "")
    .trim();
}

function isYesLikeButton(label: string): boolean {
  const n = stripChoicePunct(label);
  return /^(כן|yes|yep|sure)$/u.test(n);
}

function findYesLikeButton(buttons: string[]): string | null {
  return buttons.find((b) => isYesLikeButton(b)) ?? null;
}

function findOtherBusinessButton(buttons: string[]): string | null {
  return (
    buttons.find((b) => /עסק אחר|לא בתחום|תחום אחר/u.test(stripChoicePunct(b))) ?? null
  );
}

/** שאלה פתוחה אמיתית — לא תשובה חופשית לשאלת הפלואו */
export function marketingFlowUserTextLooksLikeQuestion(text: string): boolean {
  const t = normalizeMarketingInboundText(text);
  if (!t) return false;
  if (/[?؟]/.test(t)) return true;
  return /^(מה|איך|כמה|למה|האם|מתי|איפה|מי\b|למי|אפשר לשאול|שאלה|ו?אם)\b/u.test(
    t.toLowerCase()
  );
}

function userEchoesQuestionTopic(userText: string, questionText: string): boolean {
  const qTokens = tokenizeHe(questionText);
  const userNorm = tokenizeHe(userText).join(" ");
  if (!userNorm) return false;

  for (let i = 0; i < qTokens.length - 1; i++) {
    const a = qTokens[i]!;
    const b = qTokens[i + 1]!;
    if (HE_STOPWORDS.has(a) && HE_STOPWORDS.has(b)) continue;
    const gram = `${a} ${b}`;
    if (gram.replace(/\s/g, "").length < 6) continue;
    if (userNorm.includes(gram)) return true;
  }

  for (const tok of qTokens) {
    if (HE_STOPWORDS.has(tok) || tok.length < 5) continue;
    if (userNorm === tok || userNorm.includes(` ${tok} `) || userNorm.startsWith(`${tok} `) || userNorm.endsWith(` ${tok}`)) {
      return true;
    }
  }
  return false;
}

function questionIsFitnessBusinessAsk(questionText: string): boolean {
  return /סטודיו|חדר\s*כושר|מכון\s*כושר|כושר|ספורט|ג[''']?ים/iu.test(questionText);
}

function userMentionsFitnessBusiness(userText: string): boolean {
  return /סטודיו|חדר\s*כושר|מכון\s*כושר|כושר|קרוספיט|יוגה|פילאטיס|ג[''']?ים|מאמן|מאמנת/iu.test(
    userText
  );
}

function isYesLikeUserText(userText: string): boolean {
  const n = stripChoicePunct(userText);
  return /^(כן+|בטח|סבבה|יש(?:\s+לי|\s+לנו)?|נכון|yes)\b/u.test(n);
}

function isOffNicheUserText(userText: string): boolean {
  return /ציפורנ|מניקור|פדיקור|מספרה|קוסמטיק|שיער|בוטיק|מסעד|בית\s*קפה|אינסטלטור|עורך\s*דין|רואה\s*חשבון|נדל"?ן|מתווך/iu.test(
    userText
  );
}

/**
 * ממפה תשובת טקסט חופשי לכפתור בשאלת הפלואו.
 * null = זו שאלה פתוחה אמיתית, לא תשובה לשלב.
 */
export function inferMarketingFlowButtonFromFreeText(input: {
  questionText: string;
  buttons: string[];
  userText: string;
}): string | null {
  const buttons = input.buttons.map((b) => String(b ?? "").trim()).filter(Boolean);
  const userText = String(input.userText ?? "").trim();
  if (!buttons.length || !userText) return null;
  if (userText.length > 80) return null;

  const userNorm = stripChoicePunct(userText);
  const exact = buttons.find((b) => stripChoicePunct(b) === userNorm);
  if (exact) return exact;

  if (marketingFlowUserTextLooksLikeQuestion(userText)) return null;

  const otherBtn = findOtherBusinessButton(buttons);
  if (otherBtn && isOffNicheUserText(userText)) return otherBtn;

  const yesBtn = findYesLikeButton(buttons);
  if (!yesBtn) return null;

  if (isYesLikeUserText(userText)) return yesBtn;
  if (userEchoesQuestionTopic(userText, input.questionText)) return yesBtn;
  if (questionIsFitnessBusinessAsk(input.questionText) && userMentionsFitnessBusiness(userText)) {
    return yesBtn;
  }

  return null;
}
