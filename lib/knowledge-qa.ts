import { factFromQuestionAnswer } from "@/lib/fact-questions";

export type KnowledgeQaPair = {
  question: string;
  answer: string;
};

/**
 * דשבורדים ששומרים על שורת עובדה אחת (שאלה+תשובה מעורבבות).
 * Limitless, הסטודיו של ג׳ו ולקוחות חדשים מקבלים UI של שאלה/תשובה.
 */
const LEGACY_SINGLE_LINE_KNOWLEDGE_SLUGS = new Set(["info-2815"]);

export function usesKnowledgeQaDashboard(slug: string | null | undefined): boolean {
  const s = String(slug ?? "")
    .trim()
    .toLowerCase();
  if (!s) return true;
  return !LEGACY_SINGLE_LINE_KNOWLEDGE_SLUGS.has(s);
}

/** אשכולות כוונה — אם בעל העסק כתב אחד, זואי מתייחסת לשאר כאותו נושא. */
const INTENT_CLUSTERS: string[][] = [
  [
    "אימון ניסיון",
    "אימון היכרות",
    "שיעור ניסיון",
    "שיעור היכרות",
    "trial",
    "intro class",
    "אימוני ניסיון",
    "אימוני היכרות",
    "שיעורי ניסיון",
    "שיעור נסיון",
    "אימון נסיון",
    "trial class",
    "intro",
    "taster",
    "אימון ראשון",
    "שיעור ראשון",
  ],
  ["מנוי", "מנויים", "כרטיסייה", "כרטיסיה", "חבילה", "membership", "punch card"],
  ["חניה", "חנייה", "חניון", "parking", "איפה לחנות", "איפה אפשר לחנות"],
  ["מתחילים", "בלי ניסיון", "אין לי ניסיון", "לכל הרמות", "beginner", "all levels"],
  ["הריון", "היריון", "בהריון", "בהיריון", "pregnancy", "prenatal"],
  ["ביטול", "לבטל", "מדיניות ביטול", "הקפאה", "cancellation", "cancel"],
  ["מחיר", "כמה עולה", "עלות", "price", "cost", "pricing"],
  ["מה להביא", "מה ללבוש", "ציוד", "what to bring", "what to wear"],
  ["מקלחות", "חדרי הלבשה", "לוקרים", "showers", "lockers"],
  ["פציעה", "פציעות", "שיקום", "injury", "rehab"],
];

function normalizeIntentText(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseKnowledgeQa(raw: unknown): KnowledgeQaPair[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeQaPair[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const question = String(o.question ?? o.q ?? "").trim();
    const answer = String(o.answer ?? o.a ?? "").trim();
    if (!question && !answer) continue;
    out.push({ question, answer });
  }
  return out;
}

export function serializeKnowledgeQa(pairs: KnowledgeQaPair[]): KnowledgeQaPair[] {
  return pairs
    .map((p) => ({
      question: String(p.question ?? "").trim(),
      answer: String(p.answer ?? "").trim(),
    }))
    .filter((p) => p.question || p.answer);
}

export function normalizeQaState(pairs: KnowledgeQaPair[]): KnowledgeQaPair[] {
  const cleaned = pairs.map((p) => ({
    question: String(p.question ?? ""),
    answer: String(p.answer ?? ""),
  }));
  if (cleaned.length === 0) return [{ question: "", answer: "" }];
  return cleaned;
}

/** פירוק שורת עובדה ישנה (שאלה ותשובה באותו שדה) לזוג שאלה/תשובה. */
export function parseFactLineToQaPair(line: string): KnowledgeQaPair {
  const t = String(line ?? "").trim();
  if (!t) return { question: "", answer: "" };

  const labeled = t.match(/^שאלה:\s*(.+?)\s*\nתשובה:\s*([\s\S]+)$/u);
  if (labeled?.[1] && labeled[2] != null) {
    return { question: labeled[1].trim(), answer: labeled[2].trim() };
  }

  const qMark = t.indexOf("?");
  if (qMark >= 0 && qMark < t.length - 1) {
    const after = t.slice(qMark + 1).trim();
    if (after) {
      return { question: t.slice(0, qMark + 1).trim(), answer: after };
    }
  }

  const colon = t.match(/^([^:]{2,90}):\s+(.+)$/u);
  if (colon?.[1] && colon[2] && !/^https?:/i.test(colon[1].trim())) {
    const topic = colon[1].trim();
    if (!topic.includes("\n")) {
      return { question: `${topic}?`, answer: colon[2].trim() };
    }
  }

  return { question: "", answer: t };
}

export function legacyFactsToQaPairs(lines: string[]): KnowledgeQaPair[] {
  const pairs = lines.map((s) => parseFactLineToQaPair(s)).filter((p) => p.question || p.answer);
  return normalizeQaState(pairs);
}

export function qaPairToTraitLine(pair: KnowledgeQaPair): string {
  const q = String(pair.question ?? "").trim();
  const a = String(pair.answer ?? "").trim();
  if (!q && !a) return "";
  if (!q) return a;
  if (!a) return q;
  return factFromQuestionAnswer(q, a);
}

export function qaPairsToTraitLines(pairs: KnowledgeQaPair[]): string[] {
  return pairs.map(qaPairToTraitLine).filter(Boolean);
}

export function knowledgeQaTextBlob(pairs: KnowledgeQaPair[] | null | undefined): string {
  if (!pairs?.length) return "";
  return pairs.map((p) => `${p.question}\n${p.answer}`.trim()).filter(Boolean).join("\n");
}

export function relatedPhrasingsForQuestion(question: string, limit = 10): string[] {
  const q = normalizeIntentText(question);
  if (!q) return [];
  const found: string[] = [];
  const seen = new Set<string>([q]);
  for (const cluster of INTENT_CLUSTERS) {
    const hit = cluster.some((term) => {
      const n = normalizeIntentText(term);
      return n.length > 0 && (q.includes(n) || n.includes(q));
    });
    if (!hit) continue;
    for (const term of cluster) {
      const n = normalizeIntentText(term);
      if (!n || seen.has(n) || q.includes(n)) continue;
      seen.add(n);
      found.push(term);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

function formatQaItemForPrompt(pair: KnowledgeQaPair, index: number): string {
  const q = pair.question.trim();
  const a = pair.answer.trim();
  const variants = q ? relatedPhrasingsForQuestion(q) : [];
  const variantLine =
    variants.length > 0 ? `\n   וריאציות לאותה כוונה: ${variants.join(", ")}` : "";
  if (q && a) {
    return `${index}. שאלה/נושא (מתי להשתמש): ${q}${variantLine}\n   תשובה בתיבה (מרכאות = ציטוט מדויק לליד; מחוץ למרכאות = הוראות פנימיות): ${a}`;
  }
  if (a) {
    return `${index}. עובדה כללית (בלי שאלת נושא — השתמשי כשרלוונטי):\n   ${a}`;
  }
  return `${index}. נושא בלי תשובה: ${q}`;
}

export function formatKnowledgeQaForPrompt(pairs: KnowledgeQaPair[]): string {
  const items = serializeKnowledgeQa(pairs);
  if (items.length === 0) return "";
  return items.map((p, i) => formatQaItemForPrompt(p, i + 1)).join("\n");
}

export const KNOWLEDGE_QA_MATCH_RULES = `כללי התאמת שאלה-תשובה:
- שדה «שאלה/נושא» = מתי להשתמש בפריט. זו הכוונה, לא ניסוח מדויק של הליד. אל תעתיקי את השאלה לליד.
- שדה התשובה בתיבה = מקור האמת לניסוח. כללי המרכאות למטה חלים על השדה הזה.
- התאימי לפי משמעות ומילים נרדפות, גם אם הליד ניסח אחרת. דוגמה: «אימון היכרות», «שיעור ניסיון», «trial» ו-«אימון ראשון» הם אותה כוונה כמו «אימון ניסיון».
- אם מופיעות «וריאציות לאותה כוונה» — כל אחת מהן מפעילה את אותה תשובה.
- אם כמה פריטים יכולים להתאים — בחרי את הספציפי ביותר לשאלת הליד.
- פריט בלי שאלת נושא הוא עובדה כללית; השתמשי בו רק כשהוא רלוונטי.`;

/** חל על כל העסקים — גם UI שאלה/תשובה וגם שורת עובדה ישנה. */
export const FACT_QUOTE_RULES = `כללי שימוש בתיבת התשובה / בעובדות:
- אם יש טקסט בין מרכאות (״…״ או "…") — שלחי לליד בדיוק את מה שבתוך המרכאות, כלשונו, במלואו. אסור לקצר, אסור לשנות ניסוח, אסור לסנן שיווקי. כללי «תשובות קצרות» לא חלים על הציטוט.
- כל מה שמחוץ למרכאות באותה תיבה הוא הוראות פנימיות עבורך בלבד (מתי להשתמש, הקשר, הגבלות) — אסור לכתוב אותו לליד.
- אם אין מרכאות — הביני את התוכן ונסחי תשובה לליד ממה שהבנת. אל תעתיקי את שדה השאלה/הנושא לליד. אל תשני מספרים, שמות, מחירים או פרטים.
- קישורים בחלק שמיועד לליד (בתוך מרכאות, או בתשובה כשאין מרכאות): שלחי אותם כלשונם (טקסט רגיל, בלי Markdown).`;
