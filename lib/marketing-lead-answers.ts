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
  uniqueLeads: number;
  lastAt: string;
  sharePct: number;
};

export type AggregatedLeadAnswerQuestion = {
  flowNodeId: string | null;
  questionText: string;
  totalCount: number;
  uniqueLeads: number;
  answers: AggregatedLeadAnswerOption[];
};

export type LeadAnswersReport = {
  questions: AggregatedLeadAnswerQuestion[];
  totalRows: number;
  includesMessageHistory?: boolean;
  notice?: string;
};

function normalizeAnswerKey(text: string): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

type AnswerAggInput = {
  flowNodeId: string | null;
  questionText: string;
  answerText: string;
  phone: string;
  createdAt: string;
};

function mergeClosedAnswerRows(inputs: AnswerAggInput[]): LeadAnswersReport {
  const byQuestion = new Map<
    string,
    {
      flowNodeId: string | null;
      questionText: string;
      totalCount: number;
      leadPhones: Set<string>;
      byAnswer: Map<
        string,
        { answerText: string; count: number; lastAt: string; leadPhones: Set<string> }
      >;
    }
  >();

  for (const row of inputs) {
    const flowNodeId = row.flowNodeId;
    const questionText = String(row.questionText ?? "").trim();
    const answerText = String(row.answerText ?? "").trim();
    const createdAt = String(row.createdAt ?? "");
    const phone = String(row.phone ?? "").trim();
    if (!answerText) continue;

    const qKey = flowNodeId ? `node:${flowNodeId}` : `q:${questionText.toLowerCase()}`;
    const q =
      byQuestion.get(qKey) ??
      (() => {
        const init = {
          flowNodeId,
          questionText,
          totalCount: 0,
          leadPhones: new Set<string>(),
          byAnswer: new Map<
            string,
            { answerText: string; count: number; lastAt: string; leadPhones: Set<string> }
          >(),
        };
        byQuestion.set(qKey, init);
        return init;
      })();

    q.totalCount += 1;
    if (phone) q.leadPhones.add(phone);

    const aKey = normalizeAnswerKey(answerText);
    const agg = q.byAnswer.get(aKey);
    if (!agg) {
      const leadPhones = new Set<string>();
      if (phone) leadPhones.add(phone);
      q.byAnswer.set(aKey, { answerText, count: 1, lastAt: createdAt, leadPhones });
    } else {
      agg.count += 1;
      if (phone) agg.leadPhones.add(phone);
      if (createdAt > agg.lastAt) agg.lastAt = createdAt;
    }
  }

  const questions: AggregatedLeadAnswerQuestion[] = [...byQuestion.values()]
    .map((q) => {
      const answers = [...q.byAnswer.values()]
        .map((a) => ({
          answerText: a.answerText,
          count: a.count,
          uniqueLeads: a.leadPhones.size,
          lastAt: a.lastAt,
          sharePct: q.totalCount > 0 ? Math.round((a.count / q.totalCount) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
      return {
        flowNodeId: q.flowNodeId,
        questionText: q.questionText,
        totalCount: q.totalCount,
        uniqueLeads: q.leadPhones.size,
        answers,
      };
    })
    .sort((a, b) => b.totalCount - a.totalCount);

  return { questions, totalRows: inputs.length };
}

/** תשובות מקובצות לשאלות סגורות בפלואו — לטאב אנאליטיקה באדמין. */
export async function aggregateMarketingLeadAnswers(limit = 5000): Promise<LeadAnswersReport> {
  const empty: LeadAnswersReport = { questions: [], totalRows: 0 };

  try {
    const admin = createSupabaseAdminClient();
    const [{ data, error }, { reconstructMarketingLeadEventsFromMessages }] = await Promise.all([
      admin
        .from("marketing_lead_answers")
        .select("flow_node_id, question_text, answer_text, answer_kind, created_at, phone")
        .eq("answer_kind", "button")
        .order("created_at", { ascending: false })
        .limit(limit),
      import("@/lib/marketing-lead-message-history"),
    ]);

    const tableMissing = Boolean(
      error && /marketing_lead_answers|relation|column/i.test(error.message)
    );
    if (error && !tableMissing) {
      console.warn("[marketing-lead-answers] aggregate failed:", error.message);
    }

    const inputs: AnswerAggInput[] = [];
    for (const r of data ?? []) {
      const row = r as Record<string, unknown>;
      inputs.push({
        flowNodeId: row.flow_node_id ? String(row.flow_node_id) : null,
        questionText: String(row.question_text ?? ""),
        answerText: String(row.answer_text ?? ""),
        phone: String(row.phone ?? ""),
        createdAt: String(row.created_at ?? ""),
      });
    }

    const history = await reconstructMarketingLeadEventsFromMessages(limit);
    const tableKeys = new Set(
      inputs.map(
        (r) =>
          `${r.flowNodeId ?? ""}|${normalizeAnswerKey(r.questionText)}|${normalizeAnswerKey(r.answerText)}|${r.phone}|${r.createdAt}`
      )
    );
    for (const h of history.closed) {
      const key = `${h.flowNodeId ?? ""}|${normalizeAnswerKey(h.questionText)}|${normalizeAnswerKey(h.answerText)}|${h.phone}|${h.createdAt}`;
      if (tableKeys.has(key)) continue;
      inputs.push({
        flowNodeId: h.flowNodeId,
        questionText: h.questionText,
        answerText: h.answerText,
        phone: h.phone,
        createdAt: h.createdAt,
      });
    }

    const report = mergeClosedAnswerRows(inputs);
    return {
      ...report,
      includesMessageHistory: history.closed.length > 0,
      notice: tableMissing && inputs.length === 0 ? "missing_table" : undefined,
    };
  } catch (e) {
    console.warn("[marketing-lead-answers] aggregate exception:", e);
    return empty;
  }
}

/** מפתחות תשובות סגורות ידועות — לסינון שאלות פתוחות מנתונים מעורבבים. */
export async function loadKnownClosedAnswerKeys(limit = 10_000): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const { loadFlowButtonLabelKeys } = await import("@/lib/marketing-lead-message-history");
    for (const k of await loadFlowButtonLabelKeys()) keys.add(k);

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_lead_answers")
      .select("answer_text")
      .eq("answer_kind", "button")
      .limit(limit);
    if (!error) {
      for (const r of data ?? []) {
        const t = normalizeAnswerKey(String((r as { answer_text?: string }).answer_text ?? ""));
        if (t) keys.add(t);
      }
    }
  } catch {
    /* best effort */
  }
  return keys;
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
