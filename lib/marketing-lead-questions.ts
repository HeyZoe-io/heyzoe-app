import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type MarketingQuestionTopicId =
  | "pricing"
  | "trial_signup"
  | "product_features"
  | "human_support"
  | "whatsapp_tech"
  | "studio_business"
  | "competition"
  | "other";

export const MARKETING_QUESTION_TOPICS: { id: MarketingQuestionTopicId; label: string }[] = [
  { id: "pricing", label: "מחירים וחבילות" },
  { id: "trial_signup", label: "ניסיון / הרשמה / התחלה" },
  { id: "product_features", label: "מה זה עושה / תכונות" },
  { id: "human_support", label: "נציג / שירות אנושי" },
  { id: "whatsapp_tech", label: "וואטסאפ / טכני / חיבור" },
  { id: "studio_business", label: "סטודיו / עסק / לידים" },
  { id: "competition", label: "השוואה / מתחרים" },
  { id: "other", label: "אחר" },
];

const GREETING_RE =
  /^(היוש|הייי+|היי|הי|אהלן|שלום|בוקר טוב|ערב טוב|הלו|hello|hi|hey|שלומות|מה נשמע|מה קורה)\s*[.!?]*$/iu;

const SHORT_ACK_RE = /^(כן|לא|אוקי|אוקיי|ok|yes|no|תודה|thanks|👍|🙏|\d{1,2})[.!?]*$/iu;

const STOP_WORDS = new Set([
  "ש",
  "את",
  "על",
  "אם",
  "כי",
  "זה",
  "זו",
  "מה",
  "איך",
  "האם",
  "יש",
  "לי",
  "לך",
  "של",
  "גם",
  "עוד",
  "פה",
  "שם",
  "כן",
  "לא",
  "the",
  "a",
  "an",
  "is",
  "are",
  "to",
  "for",
  "of",
  "in",
  "on",
  "with",
]);

export function normalizeQuestionText(text: string): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function questionFingerprint(text: string): string {
  const norm = normalizeQuestionText(text);
  if (!norm) return "";
  const words = norm
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  const sig = [...new Set(words)].sort().join(" ");
  return (sig || norm).slice(0, 160);
}

export function classifyMarketingQuestionTopic(text: string): MarketingQuestionTopicId {
  const t = normalizeQuestionText(text);
  if (!t) return "other";

  if (
    /מחיר|עולה|עלות|חביל|מנוי|תשלום|₪|שקל|starter|pro|מבצע|הנחה|זול|יקר/.test(t)
  ) {
    return "pricing";
  }
  if (/ניסיון|להירשם|הרשמה|להתחיל|איך מתחילים|הקמה|להירשם|דמו|לנסות/.test(t)) {
    return "trial_signup";
  }
  if (/נציג|אדם|אנושי|שירות לקוחות|human|agent|לדבר עם|תחברו אותי/.test(t)) {
    return "human_support";
  }
  if (/וואטסאפ|whatsapp|מספר|חיבור|מטא|meta|אינטגרציה|api/.test(t)) {
    return "whatsapp_tech";
  }
  if (/סטודיו|מכון|עסק|ליד|לקוח|פילאטיס|יוגה|כושר|מאמן|מטפל/.test(t)) {
    return "studio_business";
  }
  if (/מתחר|השווא|לעומת|במקום|חלופ/.test(t)) {
    return "competition";
  }
  if (
    /מה זה|מהו|hey\s*zoe|heyzoe|איך זה עובד|תכונות|יכולות|בוט|ai|בינה|אוטומט/.test(t)
  ) {
    return "product_features";
  }
  return "other";
}

function shouldSkipQuestion(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length < 6) return true;
  if (GREETING_RE.test(raw)) return true;
  if (SHORT_ACK_RE.test(raw)) return true;
  return false;
}

type FlowNodeRow = { id: string; type: string; data: Record<string, unknown> };

function nodeStageLabel(node: FlowNodeRow | null): { key: string; label: string; nodeId: string | null } {
  if (!node) {
    return { key: "unknown", label: "לא ידוע", nodeId: null };
  }
  const d = node.data ?? {};
  const text = String(d.text ?? "").trim().slice(0, 80);
  switch (node.type) {
    case "question":
      return {
        key: `node:${node.id}`,
        label: text ? `שאלה בפלואו: ${text}` : "שאלה בפלואו",
        nodeId: node.id,
      };
    case "message":
      return { key: `node:${node.id}`, label: text ? `הודעה: ${text}` : "הודעה בפלואו", nodeId: node.id };
    case "cta":
      return { key: `node:${node.id}`, label: text ? `CTA: ${text}` : "קריאה לפעולה", nodeId: node.id };
    case "media":
      return { key: `node:${node.id}`, label: "מדיה בפלואו", nodeId: node.id };
    case "delay":
      return { key: `node:${node.id}`, label: "השהיה בפלואו", nodeId: node.id };
    case "followup":
      return { key: `node:${node.id}`, label: text ? `פולואפ: ${text}` : "פולואפ", nodeId: node.id };
    default:
      return { key: `node:${node.id}`, label: text || node.type, nodeId: node.id };
  }
}

export async function resolveMarketingFlowStageForPhone(phone: string): Promise<{
  stageKey: string;
  stageLabel: string;
  flowNodeId: string | null;
}> {
  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("marketing_flow_sessions")
    .select("current_node_id, flow_completed")
    .eq("phone", phone)
    .maybeSingle();

  if (!session) {
    return { stageKey: "post_flow", stageLabel: "אחרי הפלואו (זואי AI)", flowNodeId: null };
  }

  const row = session as { current_node_id?: string | null; flow_completed?: boolean };
  if (row.flow_completed || !row.current_node_id) {
    return { stageKey: "post_flow", stageLabel: "אחרי הפלואו (זואי AI)", flowNodeId: null };
  }

  const { data: node } = await admin
    .from("marketing_flow_nodes")
    .select("id, type, data")
    .eq("id", row.current_node_id)
    .maybeSingle();

  const stage = nodeStageLabel((node as FlowNodeRow | null) ?? null);
  return { stageKey: stage.key, stageLabel: stage.label, flowNodeId: stage.nodeId };
}

/** רושם שאלה פתוחה מליד בזואי שיווק אדמין (וואטסאפ). */
export async function recordMarketingLeadOpenQuestion(input: {
  phone: string;
  questionText: string;
}): Promise<void> {
  const questionText = String(input.questionText ?? "").trim();
  if (shouldSkipQuestion(questionText)) return;

  const phone = String(input.phone ?? "").trim().slice(0, 32);
  if (!phone) return;

  try {
    const admin = createSupabaseAdminClient();
    const fingerprint = questionFingerprint(questionText);
    if (!fingerprint) return;

    const topicId = classifyMarketingQuestionTopic(questionText);
    const { stageKey, stageLabel, flowNodeId } = await resolveMarketingFlowStageForPhone(phone);

    const { error } = await admin.from("marketing_lead_questions").insert({
      phone,
      question_text: questionText.slice(0, 2000),
      question_fingerprint: fingerprint,
      topic_id: topicId,
      flow_stage_key: stageKey.slice(0, 64),
      flow_stage_label: stageLabel.slice(0, 200),
      flow_node_id: flowNodeId,
    });

    if (error && !/marketing_lead_questions|relation|column/i.test(error.message)) {
      console.warn("[marketing-lead-questions] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[marketing-lead-questions] record exception:", e);
  }
}

export type AggregatedLeadQuestion = {
  fingerprint: string;
  text: string;
  count: number;
  lastAt: string;
  examples: string[];
};

export type LeadQuestionsReport = {
  topics: {
    id: MarketingQuestionTopicId;
    label: string;
    questions: AggregatedLeadQuestion[];
    totalCount: number;
  }[];
  byFlowStage: { stageKey: string; stageLabel: string; count: number }[];
  totalRows: number;
  notice?: string;
};

export async function aggregateMarketingLeadQuestions(limit = 5000): Promise<LeadQuestionsReport> {
  const empty: LeadQuestionsReport = {
    topics: MARKETING_QUESTION_TOPICS.map((t) => ({
      id: t.id,
      label: t.label,
      questions: [],
      totalCount: 0,
    })),
    byFlowStage: [],
    totalRows: 0,
  };

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_lead_questions")
      .select("question_text, question_fingerprint, topic_id, flow_stage_key, flow_stage_label, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (/marketing_lead_questions|relation|column/i.test(error.message)) {
        return { ...empty, notice: "missing_table" };
      }
      return empty;
    }

    const rows = data ?? [];
    const byFp = new Map<
      string,
      { text: string; count: number; lastAt: string; topicId: MarketingQuestionTopicId; examples: string[] }
    >();
    const byStage = new Map<string, { label: string; count: number }>();

    for (const r of rows) {
      const fp = String((r as { question_fingerprint?: string }).question_fingerprint ?? "").trim();
      const text = String((r as { question_text?: string }).question_text ?? "").trim();
      const topicId = String((r as { topic_id?: string }).topic_id ?? "other") as MarketingQuestionTopicId;
      const createdAt = String((r as { created_at?: string }).created_at ?? "");
      const stageKey = String((r as { flow_stage_key?: string }).flow_stage_key ?? "unknown");
      const stageLabel = String((r as { flow_stage_label?: string }).flow_stage_label ?? stageKey);

      if (!fp || !text) continue;

      const agg = byFp.get(fp);
      if (!agg) {
        byFp.set(fp, { text, count: 1, lastAt: createdAt, topicId, examples: [text] });
      } else {
        agg.count += 1;
        if (createdAt > agg.lastAt) {
          agg.lastAt = createdAt;
          agg.text = text;
        }
        if (agg.examples.length < 3 && !agg.examples.includes(text)) agg.examples.push(text);
      }

      const st = byStage.get(stageKey) ?? { label: stageLabel, count: 0 };
      st.count += 1;
      if (stageLabel && stageLabel.length > st.label.length) st.label = stageLabel;
      byStage.set(stageKey, st);
    }

    const topics = MARKETING_QUESTION_TOPICS.map((t) => {
      const questions: AggregatedLeadQuestion[] = [];
      let totalCount = 0;
      for (const [, v] of byFp) {
        if (v.topicId !== t.id) continue;
        totalCount += v.count;
        questions.push({
          fingerprint: questionFingerprint(v.text),
          text: v.text,
          count: v.count,
          lastAt: v.lastAt,
          examples: v.examples,
        });
      }
      questions.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
      return { id: t.id, label: t.label, questions, totalCount };
    }).filter((t) => t.questions.length > 0 || t.id === "other");

    const byFlowStage = [...byStage.entries()]
      .map(([stageKey, v]) => ({ stageKey, stageLabel: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count);

    return {
      topics: topics.length ? topics : empty.topics,
      byFlowStage,
      totalRows: rows.length,
    };
  } catch {
    return empty;
  }
}
