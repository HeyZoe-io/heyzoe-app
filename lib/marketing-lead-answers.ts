import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";

export type MarketingLeadAnswerKind = "button" | "free_text";

export type MarketingLeadAnswerRow = {
  id: number;
  created_at: string;
  phone: string;
  flow_node_id: string | null;
  question_text: string;
  answer_text: string;
  answer_kind: MarketingLeadAnswerKind;
};

/** רושם תשובת ליד לשאלה בפלואו השיווקי. */
export async function recordMarketingLeadFlowAnswer(input: {
  phone: string;
  questionNodeId: string;
  questionText: string;
  answerText: string;
  answerKind: MarketingLeadAnswerKind;
}): Promise<void> {
  const answerText = String(input.answerText ?? "").trim();
  if (!answerText) return;

  const phone =
    normalizePhone(input.phone) ??
    String(input.phone ?? "")
      .replace(/\D/g, "")
      .trim()
      .slice(0, 32);
  if (!phone) return;

  const questionNodeId = String(input.questionNodeId ?? "").trim();
  if (!questionNodeId) return;

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("marketing_lead_answers").insert({
      phone,
      flow_node_id: questionNodeId,
      question_text: String(input.questionText ?? "").trim().slice(0, 2000),
      answer_text: answerText.slice(0, 2000),
      answer_kind: input.answerKind === "free_text" ? "free_text" : "button",
    });

    if (error && !/marketing_lead_answers|relation|column/i.test(error.message)) {
      console.warn("[marketing-lead-answers] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[marketing-lead-answers] record exception:", e);
  }
}

export type AggregatedLeadAnswerOption = {
  answerText: string;
  count: number;
  lastAt: string;
  sharePct: number;
};

export type AggregatedLeadAnswerQuestion = {
  flowNodeId: string | null;
  questionText: string;
  totalCount: number;
  answers: AggregatedLeadAnswerOption[];
};

export type LeadAnswersReport = {
  questions: AggregatedLeadAnswerQuestion[];
  totalRows: number;
  notice?: string;
};

function normalizeAnswerKey(text: string): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** תשובות מקובצות לשאלות סגורות בפלואו — לטאב אנאליטיקה באדמין. */
export async function aggregateMarketingLeadAnswers(limit = 5000): Promise<LeadAnswersReport> {
  const empty: LeadAnswersReport = { questions: [], totalRows: 0 };

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_lead_answers")
      .select("flow_node_id, question_text, answer_text, answer_kind, created_at")
      .eq("answer_kind", "button")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (/marketing_lead_answers|relation|column/i.test(error.message)) {
        return { ...empty, notice: "missing_table" };
      }
      console.warn("[marketing-lead-answers] aggregate failed:", error.message);
      return empty;
    }

    const byQuestion = new Map<
      string,
      {
        flowNodeId: string | null;
        questionText: string;
        totalCount: number;
        byAnswer: Map<string, { answerText: string; count: number; lastAt: string }>;
      }
    >();

    for (const r of data ?? []) {
      const row = r as Record<string, unknown>;
      const flowNodeId = row.flow_node_id ? String(row.flow_node_id) : null;
      const questionText = String(row.question_text ?? "").trim();
      const answerText = String(row.answer_text ?? "").trim();
      const createdAt = String(row.created_at ?? "");
      if (!answerText) continue;

      const qKey = flowNodeId ? `node:${flowNodeId}` : `q:${questionText.toLowerCase()}`;
      const q =
        byQuestion.get(qKey) ??
        (() => {
          const init = {
            flowNodeId,
            questionText,
            totalCount: 0,
            byAnswer: new Map<string, { answerText: string; count: number; lastAt: string }>(),
          };
          byQuestion.set(qKey, init);
          return init;
        })();

      q.totalCount += 1;
      const aKey = normalizeAnswerKey(answerText);
      const agg = q.byAnswer.get(aKey);
      if (!agg) {
        q.byAnswer.set(aKey, { answerText, count: 1, lastAt: createdAt });
      } else {
        agg.count += 1;
        if (createdAt > agg.lastAt) agg.lastAt = createdAt;
      }
    }

    const questions: AggregatedLeadAnswerQuestion[] = [...byQuestion.values()]
      .map((q) => {
        const answers = [...q.byAnswer.values()]
          .map((a) => ({
            answerText: a.answerText,
            count: a.count,
            lastAt: a.lastAt,
            sharePct: q.totalCount > 0 ? Math.round((a.count / q.totalCount) * 100) : 0,
          }))
          .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
        return {
          flowNodeId: q.flowNodeId,
          questionText: q.questionText,
          totalCount: q.totalCount,
          answers,
        };
      })
      .sort((a, b) => b.totalCount - a.totalCount);

    return { questions, totalRows: (data ?? []).length };
  } catch (e) {
    console.warn("[marketing-lead-answers] aggregate exception:", e);
    return empty;
  }
}

/** מפתחות תשובות סגורות ידועות — לסינון שאלות פתוחות מנתונים מעורבבים. */
export async function loadKnownClosedAnswerKeys(limit = 10_000): Promise<Set<string>> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_lead_answers")
      .select("answer_text")
      .eq("answer_kind", "button")
      .limit(limit);
    if (error) return new Set();
    const keys = new Set<string>();
    for (const r of data ?? []) {
      const t = normalizeAnswerKey(String((r as { answer_text?: string }).answer_text ?? ""));
      if (t) keys.add(t);
    }
    return keys;
  } catch {
    return new Set();
  }
}

/** תשובות שנאספו מליד בפלואו השיווקי — מהחדש לישן. */
export async function loadMarketingLeadAnswersForPhone(
  phoneRaw: string,
  limit = 200
): Promise<{ rows: MarketingLeadAnswerRow[]; notice?: string }> {
  const phone =
    normalizePhone(phoneRaw) ??
    String(phoneRaw ?? "")
      .replace(/\D/g, "")
      .trim()
      .slice(0, 32);
  if (!phone) return { rows: [] };

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_lead_answers")
      .select("id, created_at, phone, flow_node_id, question_text, answer_text, answer_kind")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, 500));

    if (error) {
      if (/marketing_lead_answers|relation|column/i.test(error.message)) {
        return { rows: [], notice: "missing_table" };
      }
      console.warn("[marketing-lead-answers] load failed:", error.message);
      return { rows: [] };
    }

    const rows: MarketingLeadAnswerRow[] = (data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const kind = String(row.answer_kind ?? "button");
      return {
        id: Number(row.id ?? 0),
        created_at: String(row.created_at ?? ""),
        phone: String(row.phone ?? ""),
        flow_node_id: row.flow_node_id ? String(row.flow_node_id) : null,
        question_text: String(row.question_text ?? ""),
        answer_text: String(row.answer_text ?? ""),
        answer_kind: kind === "free_text" ? "free_text" : "button",
      };
    });

    return { rows };
  } catch (e) {
    console.warn("[marketing-lead-answers] load exception:", e);
    return { rows: [] };
  }
}
