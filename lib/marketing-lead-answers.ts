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
