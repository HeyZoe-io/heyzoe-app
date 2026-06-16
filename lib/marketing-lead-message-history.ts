import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  canonicalMarketingSessionId,
  extractLeadPhoneFromMarketingSession,
  isMarketingFlowStartMessage,
  MARKETING_CONVERSATIONS_SLUG,
  normalizeMarketingInboundText,
} from "@/lib/marketing-whatsapp";
import { normalizePhone } from "@/lib/phone-normalize";
import { shouldSkipQuestion } from "@/lib/marketing-lead-questions";

export type FlowQuestionDef = {
  nodeId: string;
  questionText: string;
  buttons: string[];
};

export type HistoryClosedAnswer = {
  flowNodeId: string | null;
  questionText: string;
  answerText: string;
  phone: string;
  createdAt: string;
};

export type HistoryOpenQuestion = {
  questionText: string;
  phone: string;
  createdAt: string;
  flowStageKey: string;
  flowStageLabel: string;
};

export function normalizeLeadTextKey(text: string): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const POST_FLOW_MODEL_RE =
  /marketing_ai|marketing_post_flow|marketing_flow_resume|marketing_flow_more_q/i;

function parseLoggedQuestionButtons(content: string): { questionText: string; buttons: string[] } | null {
  const raw = String(content ?? "");
  const m = raw.match(/\n\[כפתורים:\s*(.+?)\]\s*$/u);
  if (!m) return null;
  const questionText = raw.replace(/\n\[כפתורים:\s*.+\]\s*$/u, "").trim();
  const buttons = String(m[1] ?? "")
    .split("|")
    .map((b) => b.trim())
    .filter(Boolean);
  if (buttons.length < 2) return null;
  return { questionText, buttons };
}

function resolveButtonIndex(buttons: string[], userText: string): number | null {
  const normalized = normalizeMarketingInboundText(userText).toLowerCase();
  if (!normalized) return null;

  for (let i = 0; i < buttons.length; i++) {
    const label = normalizeMarketingInboundText(buttons[i] ?? "").toLowerCase();
    if (label && normalized === label) return i;
  }

  const numOnly = /^(\d+)\.?$/u.exec(normalized);
  if (numOnly) {
    const idx = Number(numOnly[1]) - 1;
    if (idx >= 0 && idx < buttons.length) return idx;
  }

  return null;
}

function findQuestionDefByText(defs: FlowQuestionDef[], questionText: string): FlowQuestionDef | null {
  const want = normalizeLeadTextKey(questionText);
  if (!want) return null;
  return defs.find((d) => normalizeLeadTextKey(d.questionText) === want) ?? null;
}

export async function loadMarketingFlowQuestionDefs(): Promise<FlowQuestionDef[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("marketing_flow_nodes").select("id, type, data").eq("type", "question");
    const defs: FlowQuestionDef[] = [];
    for (const row of data ?? []) {
      const r = row as { id?: string; data?: Record<string, unknown> };
      const nodeId = String(r.id ?? "").trim();
      if (!nodeId) continue;
      const dataObj = r.data ?? {};
      const buttons = Array.isArray(dataObj.buttons)
        ? dataObj.buttons.map((b) => String(b ?? "").trim()).filter(Boolean)
        : [];
      defs.push({
        nodeId,
        questionText: String(dataObj.text ?? "").trim(),
        buttons,
      });
    }
    return defs;
  } catch {
    return [];
  }
}

/** כל תוויות הכפתורים בפלואו — לסינון שאלות פתוחות. */
export async function loadFlowButtonLabelKeys(): Promise<Set<string>> {
  const defs = await loadMarketingFlowQuestionDefs();
  const keys = new Set<string>();
  for (const d of defs) {
    for (const b of d.buttons) {
      const k = normalizeLeadTextKey(b);
      if (k) keys.add(k);
    }
  }
  return keys;
}

type MessageRow = {
  session_id: string | null;
  role: string;
  content: string;
  created_at: string;
  model_used?: string | null;
};

function sessionPhone(sessionId: string): string {
  const fromSession = extractLeadPhoneFromMarketingSession(sessionId);
  return (
    normalizePhone(fromSession) ??
    String(fromSession ?? "")
      .replace(/\D/g, "")
      .trim()
      .slice(0, 32)
  );
}

/**
 * משחזר מתוך הודעות שיווקיות:
 * - תשובות סגורות: זוג שאלה עם [כפתורים] → תשובת משתמש תואמת
 * - שאלות פתוחות: טקסט חופשי שלא תואם כפתור ידוע
 */
export async function reconstructMarketingLeadEventsFromMessages(
  limit = 8000
): Promise<{ closed: HistoryClosedAnswer[]; open: HistoryOpenQuestion[] }> {
  const closed: HistoryClosedAnswer[] = [];
  const open: HistoryOpenQuestion[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const [defs, { data: messagesRaw }] = await Promise.all([
      loadMarketingFlowQuestionDefs(),
      admin
        .from("messages")
        .select("session_id, role, content, created_at, model_used")
        .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
        .order("created_at", { ascending: true })
        .limit(Math.min(limit, 12_000)),
    ]);

    const buttonKeys = new Set<string>();
    for (const d of defs) {
      for (const b of d.buttons) {
        const k = normalizeLeadTextKey(b);
        if (k) buttonKeys.add(k);
      }
    }

    const bySession = new Map<string, MessageRow[]>();
    for (const row of messagesRaw ?? []) {
      const r = row as MessageRow;
      const sid = canonicalMarketingSessionId(String(r.session_id ?? ""));
      if (!sid || sid === "anon") continue;
      const list = bySession.get(sid) ?? [];
      list.push(r);
      bySession.set(sid, list);
    }

    for (const [sessionId, rows] of bySession.entries()) {
      const phone = sessionPhone(sessionId);
      let pendingQ: { nodeId: string | null; questionText: string; buttons: string[] } | null = null;
      let postFlow = false;

      for (const msg of rows) {
        const content = String(msg.content ?? "").trim();
        const createdAt = String(msg.created_at ?? "");
        const modelUsed = String(msg.model_used ?? "");

        if (msg.role === "assistant") {
          const parsed = parseLoggedQuestionButtons(content);
          if (parsed) {
            const def = findQuestionDefByText(defs, parsed.questionText);
            pendingQ = {
              nodeId: def?.nodeId ?? null,
              questionText: def?.questionText || parsed.questionText,
              buttons: parsed.buttons,
            };
            postFlow = false;
            continue;
          }

          if (POST_FLOW_MODEL_RE.test(modelUsed) || content.includes("מה דעתך, אפשר להמשיך")) {
            postFlow = true;
            pendingQ = null;
          }
          continue;
        }

        if (msg.role !== "user" || !content) continue;
        if (isMarketingFlowStartMessage(content)) {
          pendingQ = null;
          postFlow = false;
          continue;
        }

        const userKey = normalizeLeadTextKey(content);
        if (pendingQ) {
          const idx = resolveButtonIndex(pendingQ.buttons, content);
          if (idx !== null) {
            closed.push({
              flowNodeId: pendingQ.nodeId,
              questionText: pendingQ.questionText,
              answerText: pendingQ.buttons[idx] ?? content,
              phone,
              createdAt,
            });
            pendingQ = null;
            continue;
          }
        }

        if (shouldSkipQuestion(content)) continue;
        if (buttonKeys.has(userKey)) continue;

        open.push({
          questionText: content.slice(0, 2000),
          phone,
          createdAt,
          flowStageKey: postFlow ? "post_flow" : pendingQ ? `node:${pendingQ.nodeId ?? "unknown"}` : "historical_messages",
          flowStageLabel: postFlow
            ? "אחרי הפלואו (זואי AI)"
            : pendingQ
              ? `שאלה בפלואו: ${pendingQ.questionText.slice(0, 80)}`
              : "היסטורי מתוך שיחות שיווקיות",
        });
      }
    }
  } catch (e) {
    console.warn("[marketing-lead-message-history] reconstruct failed:", e);
  }

  return { closed, open };
}
