import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";
import { DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES } from "@/lib/marketing-zoe-legal-defaults";
import { clampMarketingDelaySeconds } from "@/lib/marketing-flow-delay";
import {
  buildMarketingSupportWaUrl,
  replyContainsMarketingSupportWaLink,
  supportWhatsAppPrefillFromUserMessage,
} from "@/lib/marketing-support-wa";
import { sanitizeZoeDashes } from "@/lib/zoe-text";
import {
  MARKETING_CONVERSATIONS_SLUG,
  MARKETING_WA_PHONE_NUMBER_ID,
  isMarketingFlowStartMessage,
  logMarketingWhatsAppMessage,
  marketingWaSessionId,
  normalizeMarketingInboundText,
  sendMarketingWhatsApp,
} from "@/lib/marketing-whatsapp";
import { fetchRecentSessionMessages } from "@/lib/analytics";
import {
  sendMetaWhatsAppMessage,
  buildMetaInteractivePayload,
  type MetaWhatsAppOutgoing,
} from "@/lib/whatsapp";

import {
  getMarketingFlowCache,
  setMarketingFlowCache,
  type MarketingFlowEdge,
  type MarketingFlowNode,
} from "@/lib/marketing-flow-cache";

type FlowNode = MarketingFlowNode;
type FlowEdge = MarketingFlowEdge;

export type MarketingOpenQPauseState = "none" | "await_resume" | "more_questions";

export type MarketingFlowInboundResult = {
  handled: boolean;
  /** פלואו פעיל — לענות ב-AI ולהציע «להמשיך?» */
  openQuestionInFlow?: boolean;
};

type Session = {
  id: string;
  phone: string;
  current_node_id: string | null;
  flow_completed: boolean;
  open_q_pause_state?: string | null;
  last_question_node_id?: string | null;
};

export const MARKETING_FLOW_RESUME_PROMPT = "מה דעתך, אפשר להמשיך?";
export const MARKETING_FLOW_BTN_CONTINUE = "בואו נמשיך!";
export const MARKETING_FLOW_BTN_MORE_Q = "יש לי עוד שאלה";
export const MARKETING_FLOW_MORE_Q_REPLY = "אין בעיה! אני כאן בשביל זה. מה השאלה?";

/** שורת סיום חובה בתשובות AI אחרי סיום הפלואו השיווקי (נשלחת עם כפתורים) */
export const MARKETING_POST_FLOW_CLOSING_LINE =
  "יש לך שאלות נוספות או שאנחנו מוכנים להתחיל? :)";

export const MARKETING_POST_FLOW_BTN_CHECKOUT = "להמשך לסליקה";
/** קישור LP מחירים אחרי לחיצה על «להמשך לסליקה» */
export const MARKETING_POST_FLOW_CHECKOUT_URL =
  "https://heyzoe.io/lp-leads?utm_source=whatsapp&utm_medium=chat&utm_campaign=zoe_marketing#pricing";
export const MARKETING_POST_FLOW_CHECKOUT_CTA_LABEL = "הצטרפו לזואי";
export const MARKETING_POST_FLOW_BTN_MORE_Q = "יש לי שאלה נוספת";
export const MARKETING_POST_FLOW_BTN_HUMAN = "נציג אנושי";
export const MARKETING_POST_FLOW_MORE_Q_REPLY = "אין בעיה, כתבו לי ואענה!";

function normalizeOpenQPauseState(raw: unknown): MarketingOpenQPauseState {
  const s = String(raw ?? "").trim();
  if (s === "await_resume" || s === "more_questions") return s;
  return "none";
}

function labelMatchesChoice(text: string, choice: string): boolean {
  const n = normalizeMarketingInboundText(text).toLowerCase().replace(/[!?.…]+$/gu, "").trim();
  const c = normalizeMarketingInboundText(choice).toLowerCase().replace(/[!?.…]+$/gu, "").trim();
  return Boolean(n && c && n === c);
}

function isMarketingFlowContinueChoice(text: string): boolean {
  return labelMatchesChoice(text, MARKETING_FLOW_BTN_CONTINUE);
}

function isMarketingFlowMoreQuestionChoice(text: string): boolean {
  return labelMatchesChoice(text, MARKETING_FLOW_BTN_MORE_Q);
}

async function setMarketingOpenQPauseState(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phone: string,
  state: MarketingOpenQPauseState
): Promise<void> {
  const { error } = await admin
    .from("marketing_flow_sessions")
    .update({ open_q_pause_state: state, updated_at: new Date().toISOString() })
    .eq("phone", phone);
  if (error && /open_q_pause_state|column/i.test(String(error.message ?? ""))) {
    console.warn("[marketing-flow] open_q_pause_state update skipped (column missing?):", error.message);
  }
}

async function loadMarketingFlowSession(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phone: string
): Promise<Session | null> {
  const withLastQ = await admin
    .from("marketing_flow_sessions")
    .select("id, phone, current_node_id, flow_completed, open_q_pause_state, last_question_node_id")
    .eq("phone", phone)
    .maybeSingle();
  if (!withLastQ.error) return (withLastQ.data as Session | null) ?? null;
  if (/last_question_node_id|column/i.test(String(withLastQ.error.message ?? ""))) {
    const withPause = await admin
      .from("marketing_flow_sessions")
      .select("id, phone, current_node_id, flow_completed, open_q_pause_state")
      .eq("phone", phone)
      .maybeSingle();
    if (!withPause.error) return (withPause.data as Session | null) ?? null;
  }
  if (/open_q_pause_state|column/i.test(String(withLastQ.error.message ?? ""))) {
    const fallback = await admin
      .from("marketing_flow_sessions")
      .select("id, phone, current_node_id, flow_completed")
      .eq("phone", phone)
      .maybeSingle();
    if (fallback.error) return null;
    return (fallback.data as Session | null) ?? null;
  }
  return null;
}

async function persistMarketingFlowPosition(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  sessionId: string;
  nextNodeId: string | null;
  waitingForAnswer: boolean;
  /** undefined = אל תשנה את last_question_node_id */
  lastQuestionNodeId?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = {
    current_node_id: input.nextNodeId,
    flow_completed: !input.waitingForAnswer && !input.nextNodeId,
    open_q_pause_state: "none",
    updated_at: new Date().toISOString(),
  };
  if (input.lastQuestionNodeId !== undefined) {
    patch.last_question_node_id = input.lastQuestionNodeId;
  }
  const { error } = await input.admin
    .from("marketing_flow_sessions")
    .update(patch)
    .eq("id", input.sessionId);
  if (error && /last_question_node_id|column/i.test(String(error.message ?? ""))) {
    delete patch.last_question_node_id;
    await input.admin
      .from("marketing_flow_sessions")
      .update(patch)
      .eq("id", input.sessionId);
  }
}

/** ניתוב מחדש לפי כפתור אחר בשאלה האחרונה שנענתה (שאלה אחת אחורה) */
async function tryRerouteFromLastAnsweredQuestion(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  sess: Session;
  currentNode: FlowNode | undefined;
  userText: string;
  phone: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}): Promise<MarketingFlowInboundResult | null> {
  const lastId = String(input.sess.last_question_node_id ?? "").trim();
  if (!lastId) return null;
  if (input.currentNode?.id === lastId) return null;

  const lastQuestion = input.nodes.find((n) => n.id === lastId);
  if (!lastQuestion || lastQuestion.type !== "question") return null;
  if (!matchesMarketingFlowQuestionAnswer(lastQuestion, input.edges, input.userText)) return null;

  const nextNode = findNextNode(lastQuestion.id, input.edges, input.nodes, input.userText);
  if (!nextNode) {
    await persistMarketingFlowPosition({
      admin: input.admin,
      sessionId: input.sess.id,
      nextNodeId: null,
      waitingForAnswer: false,
      lastQuestionNodeId: lastQuestion.id,
    });
    return { handled: false };
  }

  const { waitingForAnswer, nextNodeId } = await sendNodeChain(
    nextNode,
    input.phone,
    input.edges,
    input.nodes
  );

  await persistMarketingFlowPosition({
    admin: input.admin,
    sessionId: input.sess.id,
    nextNodeId,
    waitingForAnswer,
    lastQuestionNodeId: lastQuestion.id,
  });

  console.info("[marketing-flow] reroute from last answered question", {
    phone: input.phone,
    lastQuestionNodeId: lastId,
    newCurrentNodeId: nextNodeId,
    userText: input.userText.slice(0, 80),
  });

  return { handled: true };
}

async function sendMarketingFlowResumePrompt(phone: string): Promise<void> {
  const interactive = buildMetaInteractivePayload(MARKETING_FLOW_RESUME_PROMPT, [
    MARKETING_FLOW_BTN_CONTINUE,
    MARKETING_FLOW_BTN_MORE_Q,
  ]);
  if (interactive) {
    await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, interactive);
    await logMarketingWhatsAppMessage({
      leadPhone: phone,
      role: "assistant",
      content: `${MARKETING_FLOW_RESUME_PROMPT}\n[כפתורים: ${MARKETING_FLOW_BTN_CONTINUE} | ${MARKETING_FLOW_BTN_MORE_Q}]`,
      model_used: "marketing_flow_resume_prompt",
    });
    return;
  }
  const fallback = `${MARKETING_FLOW_RESUME_PROMPT}\n1. ${MARKETING_FLOW_BTN_CONTINUE}\n2. ${MARKETING_FLOW_BTN_MORE_Q}`;
  await sendMarketingWhatsApp(phone, fallback, { model_used: "marketing_flow_resume_prompt" });
}

async function resendMarketingFlowQuestionNode(phone: string, node: FlowNode): Promise<void> {
  await sendNodeMessage(node, phone);
}

/** תשובת AI + «מה דעתך, אפשר להמשיך?» באמצע פלואו פעיל */
export async function answerOpenQuestionDuringMarketingFlow(
  phoneRaw: string,
  userText: string
): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;

  const { tryHandleMarketingHumanAgentInbound } = await import("@/lib/marketing-human-agent");
  if (await tryHandleMarketingHumanAgentInbound(phone, userText)) return;

  const { recordMarketingLeadOpenQuestion } = await import("@/lib/marketing-lead-questions");
  void recordMarketingLeadOpenQuestion({ phone, questionText: userText });

  const reply = await callMarketingAI(userText, { leadPhone: phone, skipPostFlowClosing: true });
  await sendMarketingWhatsApp(phone, reply, { model_used: "marketing_ai_open_q" });
  await sendMarketingFlowResumePrompt(phone);

  const admin = createSupabaseAdminClient();
  await setMarketingOpenQPauseState(admin, phone, "await_resume");
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if this phone number has never messaged the marketing line before.
 */
export async function isFirstContact(phoneRaw: string): Promise<boolean> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return true;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("marketing_flow_sessions")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  return !data;
}

/**
 * Load all nodes and edges for the active marketing flow.
 */
async function loadFlow(): Promise<{ nodes: FlowNode[]; edges: FlowEdge[]; isActive: boolean }> {
  const cached = getMarketingFlowCache();
  if (cached) return cached;

  const admin = createSupabaseAdminClient();
  const [{ data: nodes }, { data: edges }, { data: settings }] = await Promise.all([
    admin.from("marketing_flow_nodes").select("id, type, data").order("created_at", { ascending: true }),
    admin.from("marketing_flow_edges").select("id, source_node_id, target_node_id, label").order("id", { ascending: true }),
    admin.from("marketing_flow_settings").select("is_active").eq("id", 1).maybeSingle(),
  ]);
  const snapshot = {
    nodes: (nodes ?? []) as unknown as FlowNode[],
    edges: (edges ?? []) as unknown as FlowEdge[],
    isActive: Boolean((settings as { is_active?: boolean } | null)?.is_active),
  };
  setMarketingFlowCache(snapshot);
  return snapshot;
}

type EdgeLabelMeta = { text: string; sourceHandle: string | null };

/** Decode edge label — may contain JSON with sourceHandle (btn-0, btn-1, …). */
function decodeEdgeMeta(raw: string): EdgeLabelMeta {
  const s = String(raw ?? "");
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { _mf?: number; h?: string; t?: string };
      if (o && o._mf === 1) {
        return {
          text: String(o.t ?? ""),
          sourceHandle: typeof o.h === "string" && o.h.trim() ? o.h.trim() : null,
        };
      }
    } catch {
      /* plain text */
    }
  }
  return { text: s, sourceHandle: null };
}

function decodeEdgeLabel(raw: string): string {
  return decodeEdgeMeta(raw).text;
}

function questionButtonsFromNode(node: FlowNode): string[] {
  const data = node.data as Record<string, unknown>;
  return Array.isArray(data.buttons)
    ? data.buttons.map((b) => String(b ?? "").trim()).filter(Boolean)
    : [];
}

/** אינדקס כפתור (0-based) לפי תשובת הלקוח — טקסט כפתור או מספר 1/2/3 */
function resolveQuestionButtonIndex(node: FlowNode, outEdges: FlowEdge[], userText: string): number | null {
  const buttons = questionButtonsFromNode(node);
  if (buttons.length === 0) return null;

  const normalized = normalizeMarketingInboundText(userText).toLowerCase();
  if (!normalized) return null;

  for (let i = 0; i < buttons.length; i++) {
    const label = normalizeMarketingInboundText(buttons[i]).toLowerCase();
    if (label && normalized === label) return i;
  }

  const numOnly = /^(\d+)\.?$/u.exec(normalized);
  if (numOnly) {
    const idx = Number(numOnly[1]) - 1;
    if (idx >= 0 && idx < buttons.length) return idx;
  }

  if (normalized.length <= 40) {
    for (let i = 0; i < buttons.length; i++) {
      const label = normalizeMarketingInboundText(buttons[i]).toLowerCase();
      if (!label) continue;
      if (normalized === label || normalized.startsWith(`${label} `) || normalized.startsWith(`${label},`)) {
        return i;
      }
    }
  }

  for (const e of outEdges) {
    const { text, sourceHandle } = decodeEdgeMeta(e.label);
    const edgeText = normalizeMarketingInboundText(text).toLowerCase();
    if (!edgeText || edgeText !== normalized) continue;
    if (sourceHandle?.startsWith("btn-")) {
      const idx = Number.parseInt(sourceHandle.replace("btn-", ""), 10);
      if (idx >= 0 && idx < buttons.length) return idx;
    }
  }

  return null;
}

function findQuestionOutEdge(currentNode: FlowNode, outEdges: FlowEdge[], userText: string): FlowEdge | null {
  const btnIndex = resolveQuestionButtonIndex(currentNode, outEdges, userText);
  const buttons = questionButtonsFromNode(currentNode);

  if (btnIndex !== null) {
    const handleId = `btn-${btnIndex}`;
    const byHandle = outEdges.find((e) => decodeEdgeMeta(e.label).sourceHandle === handleId);
    if (byHandle) return byHandle;

    const want = normalizeMarketingInboundText(buttons[btnIndex] ?? "").toLowerCase();
    const byCurrentButtonText = outEdges.find((e) => {
      const t = normalizeMarketingInboundText(decodeEdgeMeta(e.label).text).toLowerCase();
      return want && t === want;
    });
    if (byCurrentButtonText) return byCurrentButtonText;
  }

  const normalized = normalizeMarketingInboundText(userText).toLowerCase();
  return (
    outEdges.find((e) => {
      const t = normalizeMarketingInboundText(decodeEdgeMeta(e.label).text).toLowerCase();
      return t && t === normalized;
    }) ?? null
  );
}

function getMarketingQuestionAnswerOptions(currentNode: FlowNode, edges: FlowEdge[]): string[] {
  const data = currentNode.data as Record<string, unknown>;
  const buttons = Array.isArray(data.buttons)
    ? data.buttons.map((b) => String(b ?? "").trim()).filter(Boolean)
    : [];
  const outEdges = edges.filter((e) => e.source_node_id === currentNode.id);
  const edgeLabels = outEdges
    .map((e) => decodeEdgeLabel(e.label).trim())
    .filter(Boolean);
  return [...new Set([...buttons, ...edgeLabels])];
}

/** תשובה שמתאימה לכפתור/אפשרות בנוד שאלה — אחרת שאלה פתוחה → AI */
function matchesMarketingFlowQuestionAnswer(
  currentNode: FlowNode,
  edges: FlowEdge[],
  userText: string
): boolean {
  const options = getMarketingQuestionAnswerOptions(currentNode, edges);
  if (options.length === 0) return true;

  const normalized = normalizeMarketingInboundText(userText).toLowerCase();
  if (!normalized) return false;

  for (const opt of options) {
    const label = normalizeMarketingInboundText(opt).toLowerCase();
    if (label && normalized === label) return true;
  }

  const numOnly = /^(\d+)\.?$/u.exec(normalized);
  if (numOnly) {
    const idx = Number(numOnly[1]);
    if (idx >= 1 && idx <= options.length) return true;
  }

  if (normalized.length <= 40) {
    for (const opt of options) {
      const label = normalizeMarketingInboundText(opt).toLowerCase();
      if (!label) continue;
      if (normalized === label || normalized.startsWith(`${label} `) || normalized.startsWith(`${label},`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find the first node in the flow (the one with no incoming edges).
 */
function findStartNode(nodes: FlowNode[], edges: FlowEdge[]): FlowNode | null {
  const hasIncoming = new Set(edges.map((e) => e.target_node_id));
  return nodes.find((n) => !hasIncoming.has(n.id)) ?? nodes[0] ?? null;
}

/**
 * Find the next node after the current one, optionally matching a button label for question nodes.
 */
function findNextNode(
  currentNodeId: string,
  edges: FlowEdge[],
  nodes: FlowNode[],
  userText?: string
): FlowNode | null {
  const currentNode = nodes.find((n) => n.id === currentNodeId);
  const outEdges = edges.filter((e) => e.source_node_id === currentNodeId);

  if (outEdges.length === 0) return null;

  if (currentNode?.type === "question" && outEdges.length > 1 && userText) {
    const matched = findQuestionOutEdge(currentNode, outEdges, userText);
    if (matched) {
      return nodes.find((n) => n.id === matched.target_node_id) ?? null;
    }
    console.warn("[marketing-flow] no matching edge for question answer", {
      nodeId: currentNodeId,
      userText: userText.slice(0, 80),
      outEdges: outEdges.length,
    });
    return null;
  }

  const targetId = outEdges[0]!.target_node_id;
  return nodes.find((n) => n.id === targetId) ?? null;
}

/**
 * Send the content of a node as a WhatsApp message.
 */
async function sendNodeMessage(node: FlowNode, phone: string): Promise<void> {
  const data = node.data;
  const text = String(data.text ?? "").trim();

  switch (node.type) {
    case "message":
    case "followup": {
      if (!text) return;
      await sendMarketingWhatsApp(phone, text);
      break;
    }
    case "question": {
      const buttons = Array.isArray(data.buttons) ? data.buttons.map((b: unknown) => String(b ?? "").trim()).filter(Boolean) : [];
      if (buttons.length >= 2) {
        const interactive = buildMetaInteractivePayload(text || "בחרו אפשרות:", buttons);
        if (interactive) {
          await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, interactive);
          await logMarketingWhatsAppMessage({
            leadPhone: phone,
            role: "assistant",
            content: text ? `${text}\n[כפתורים: ${buttons.join(" | ")}]` : `[כפתורים: ${buttons.join(" | ")}]`,
          });
          return;
        }
      }
      if (text) await sendMarketingWhatsApp(phone, text);
      break;
    }
    case "media": {
      const mediaUrl = String(data.mediaUrl ?? "").trim();
      const mediaKind = data.mediaKind === "video" ? "video" : "image";
      if (mediaUrl) {
        const mediaOutgoing: MetaWhatsAppOutgoing = {
          type: "interactive" as const,
          interactive: {},
        };
        try {
          const metaToken = process.env.META_ACCESS_TOKEN?.trim() || process.env.WHATSAPP_SYSTEM_TOKEN?.trim() || "";
          const url = `https://graph.facebook.com/v21.0/${MARKETING_WA_PHONE_NUMBER_ID}/messages`;
          const body: Record<string, unknown> = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone.replace(/^\+/, ""),
            type: mediaKind,
            [mediaKind]: { link: mediaUrl, ...(text ? { caption: text } : {}) },
          };
          await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${metaToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (e) {
          console.error("[marketing-flow] media send error:", e);
          if (text) await sendMarketingWhatsApp(phone, text);
          else
            await logMarketingWhatsAppMessage({
              leadPhone: phone,
              role: "assistant",
              content: `[${mediaKind}]`,
            });
        }
        void mediaOutgoing;
      } else if (text) {
        await sendMarketingWhatsApp(phone, text);
      }
      break;
    }
    case "cta": {
      const ctaUrl = String(data.url ?? "").trim();
      if (ctaUrl && text) {
        const { buildMetaCtaUrlOutgoing } = await import("@/lib/whatsapp");
        const { HEYZOE_MARKETING_CTA_SENT } = await import("@/lib/lp-analytics");
        const outgoing = buildMetaCtaUrlOutgoing(text, "לחצו כאן", ctaUrl);
        await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, outgoing);
        await logMarketingWhatsAppMessage({
          leadPhone: phone,
          role: "assistant",
          content: `${HEYZOE_MARKETING_CTA_SENT}\n${text}\n${ctaUrl}`,
        });
      } else if (text) {
        await sendMarketingWhatsApp(phone, text);
      }
      break;
    }
    default: {
      if (text) await sendMarketingWhatsApp(phone, text);
    }
  }
}

/**
 * Send a node and keep advancing through non-question nodes automatically.
 * Stops when hitting a question (needs user input), end of flow, or safety limit.
 * Returns the last node sent, or null if nothing was sent.
 */
async function sendNodeChain(
  startNode: FlowNode,
  phone: string,
  edges: FlowEdge[],
  nodes: FlowNode[],
): Promise<{ lastSent: FlowNode; waitingForAnswer: boolean; nextNodeId: string | null }> {
  let current = startNode;
  const visited = new Set<string>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (visited.has(current.id)) break;
    visited.add(current.id);

    if (current.type === "delay") {
      const sec = clampMarketingDelaySeconds((current.data as Record<string, unknown>)?.delaySeconds);
      console.info("[marketing-flow] delay node", current.id, "seconds:", sec);
      await sleepMs(sec * 1000);
    } else {
      await sendNodeMessage(current, phone);
    }

    if (current.type === "question") {
      return { lastSent: current, waitingForAnswer: true, nextNodeId: current.id };
    }

    const next = findNextNode(current.id, edges, nodes);
    if (!next) {
      return { lastSent: current, waitingForAnswer: false, nextNodeId: null };
    }

    current = next;
  }

  return { lastSent: current, waitingForAnswer: false, nextNodeId: null };
}

/**
 * Handle an inbound message on the marketing line.
 * - «היי» / «היי זואי» / «היי זואי!» בלבד → מאפס סשן ומתחיל פלואו (גם אחרי flow_completed)
 * - פנייה ראשונה עם שאלה או משפט נוסף → לא מתחיל פלואו (מעביר ל-AI)
 * - שאלה פתוחה באמצע פלואו → AI + «מה דעתך, אפשר להמשיך?» + כפתורים
 * - Flow completed → return false (caller should use Zoe AI)
 */
export async function handleMarketingFlowInbound(
  phoneRaw: string,
  userText: string,
  opts?: { profileName?: string }
): Promise<MarketingFlowInboundResult> {
  const { isHeyzoeOwnerOptInMessage, tryHandleHeyzoeOwnerOptIn } = await import(
    "@/lib/notifications/owner-opt-in"
  );
  if (isHeyzoeOwnerOptInMessage(userText)) {
    const ownerHandled = await tryHandleHeyzoeOwnerOptIn({ senderPhone: phoneRaw, userText });
    console.info("[marketing-flow] HEYZOE_OWNER opt-in via flow guard:", { ownerHandled, phoneRaw });
    return { handled: true };
  }

  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    console.warn("[marketing-flow] invalid phone:", phoneRaw);
    return { handled: false };
  }

  const { tryHandleMarketingHumanAgentInbound } = await import("@/lib/marketing-human-agent");
  if (await tryHandleMarketingHumanAgentInbound(phone, userText)) {
    console.info("[marketing-flow] human agent request handled for:", phone);
    return { handled: true };
  }

  const admin = createSupabaseAdminClient();
  const { nodes, edges, isActive } = await loadFlow();

  if (!isActive || nodes.length === 0) {
    return { handled: false };
  }

  const startFlowMessage = isMarketingFlowStartMessage(userText);

  const session = await loadMarketingFlowSession(admin, phone);

  if (startFlowMessage) {
    await admin.from("marketing_flow_sessions").delete().eq("phone", phone);
    console.info("[marketing-flow] flow start/restart for:", phone, { hadSession: Boolean(session) });

    const startNode = findStartNode(nodes, edges);
    if (!startNode) return { handled: false };

    const { waitingForAnswer, nextNodeId } = await sendNodeChain(startNode, phone, edges, nodes);

    const nowIso = new Date().toISOString();
    const profileName = String(opts?.profileName ?? "").trim();
    const sessionUpsert: Record<string, unknown> = {
      phone,
      current_node_id: nextNodeId,
      flow_completed: !waitingForAnswer && !nextNodeId,
      open_q_pause_state: "none",
      last_question_node_id: null,
      last_user_message_at: nowIso,
      updated_at: nowIso,
    };
    if (profileName) sessionUpsert.full_name = profileName;
    await admin.from("marketing_flow_sessions").upsert(sessionUpsert, { onConflict: "phone" });

    if (!session) {
      const { trackWaNewLead } = await import("@/lib/admin-marketing-analytics");
      void trackWaNewLead(phone);
    }

    return { handled: true };
  }

  if (!session) {
    if (await tryHandleMarketingPostFlowMenuReply(phone, userText)) {
      return { handled: true };
    }
    return { handled: false };
  }

  const sess = session as unknown as Session;

  if (sess.flow_completed || !sess.current_node_id) {
    if (await tryHandleMarketingPostFlowMenuReply(phone, userText)) {
      return { handled: true };
    }
    return { handled: false };
  }

  const pauseState = normalizeOpenQPauseState(sess.open_q_pause_state);

  const currentNode = nodes.find((n) => n.id === sess.current_node_id);

  if (isMarketingFlowContinueChoice(userText) && currentNode) {
    await resendMarketingFlowQuestionNode(phone, currentNode);
    await setMarketingOpenQPauseState(admin, phone, "none");
    console.info("[marketing-flow] resume flow after open Q", { phone, nodeId: currentNode.id });
    return { handled: true };
  }

  if (isMarketingFlowMoreQuestionChoice(userText)) {
    await sendMarketingWhatsApp(phone, MARKETING_FLOW_MORE_Q_REPLY, {
      model_used: "marketing_flow_more_q",
    });
    await setMarketingOpenQPauseState(admin, phone, "more_questions");
    return { handled: true };
  }

  if (pauseState === "more_questions") {
    return { handled: false, openQuestionInFlow: true };
  }

  if (pauseState === "await_resume") {
    return { handled: false, openQuestionInFlow: true };
  }

  if (!currentNode) {
    console.warn("[marketing-flow] stale session node (flow was likely saved in admin)", {
      phone,
      current_node_id: sess.current_node_id,
    });
    await admin.from("marketing_flow_sessions").delete().eq("phone", phone);
    await sendMarketingWhatsApp(
      phone,
      "עדכנו את הפלואו בשיווק. שלחו «היי זואי!» כדי להתחיל מחדש 🙂"
    );
    return { handled: true };
  }

  let nextNode: FlowNode | null;
  let answeredQuestionId: string | null = null;

  if (currentNode.type === "question") {
    if (!matchesMarketingFlowQuestionAnswer(currentNode, edges, userText)) {
      const rerouted = await tryRerouteFromLastAnsweredQuestion({
        admin,
        sess,
        currentNode,
        userText,
        phone,
        nodes,
        edges,
      });
      if (rerouted) return rerouted;

      console.info("[marketing-flow] open question during flow — AI + resume prompt", {
        phone,
        nodeId: currentNode.id,
      });
      return { handled: false, openQuestionInFlow: true };
    }
    answeredQuestionId = currentNode.id;
    nextNode = findNextNode(currentNode.id, edges, nodes, userText);
  } else {
    const rerouted = await tryRerouteFromLastAnsweredQuestion({
      admin,
      sess,
      currentNode,
      userText,
      phone,
      nodes,
      edges,
    });
    if (rerouted) return rerouted;

    nextNode = findNextNode(currentNode.id, edges, nodes);
  }

  if (!nextNode) {
    await persistMarketingFlowPosition({
      admin,
      sessionId: sess.id,
      nextNodeId: null,
      waitingForAnswer: false,
      ...(answeredQuestionId ? { lastQuestionNodeId: answeredQuestionId } : {}),
    });
    return { handled: false };
  }

  const { waitingForAnswer, nextNodeId } = await sendNodeChain(nextNode, phone, edges, nodes);

  await persistMarketingFlowPosition({
    admin,
    sessionId: sess.id,
    nextNodeId,
    waitingForAnswer,
    ...(answeredQuestionId ? { lastQuestionNodeId: answeredQuestionId } : {}),
  });

  return { handled: true };
}

const MARKETING_CORE_IDENTITY = `את זואי — עוזרת AI חכמה של HeyZoe.
HeyZoe היא פלטפורמה שמאפשרת לבעלי עסקים (סטודיו, מאמנים, מטפלים) לחבר עוזרת AI בוואטסאפ שעונה ללידים שלהם 24/7, מטפלת בשאלות חוזרות, ומקדמת אותם להרשמה.

קראי את כל סעיפי החוקיות, העובדות וההנחיות המופיעים בהמשך בהודעת המערכת, והתנהגי בהתאם — במיוחד כללי העברית התקנית, הפורמט לוואטסאפ והטון.

סגנון אחרי הפלואו (כשהליד כותב חופשי):
- עני ישירות לנושא שהמשתמש העלה (אם כתב על קרוספיט — עני על לידים/מענה/ניסיון באותו הקשר; אל תסטי לנושאים כלליים או מטאפורות לא קשורות כמו ״תעלומה״, ״משימה״, ״הרפתקה״).
- טון עסקי־חם: לא סלנג היפר (לא ״יאללה״, לא ״אז אומר לך״ או פתיחים ריקים). עדיף משפט ראשון שמזהה את דבריהם או שאלה עניינית קצרה.
- בלי דימויים מוזרים או בדיחות שלא קשורות ל־HeyZoe או לשאלה.
- סיום (חובה): אל תוסיפי בסוף תשובתך את «יש לך שאלות נוספות…» — המערכת שולחת אחריך הודעה נפרדת עם כפתורים.`;

async function loadMarketingAiSettings(): Promise<{
  facts: string[];
  supportPhone: string;
  legalGuidelines: string[];
}> {
  try {
    const admin = createSupabaseAdminClient();
    let data: Record<string, unknown> | null = null;
    let error: { message?: string } | null = null;
    {
      const res = await admin
        .from("marketing_flow_settings")
        .select("open_facts, marketing_support_phone, marketing_legal_guidelines")
        .eq("id", 1)
        .maybeSingle();
      data = (res.data as Record<string, unknown> | null) ?? null;
      error = res.error as { message?: string } | null;
    }
    if (error?.message && /marketing_legal_guidelines|column/i.test(error.message)) {
      const res = await admin
        .from("marketing_flow_settings")
        .select("open_facts, marketing_support_phone")
        .eq("id", 1)
        .maybeSingle();
      data = (res.data as Record<string, unknown> | null) ?? null;
      error = res.error as { message?: string } | null;
    }
    if (error || !data) {
      return {
        facts: [],
        supportPhone: "",
        legalGuidelines: DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES,
      };
    }
    const row = data as {
      open_facts?: unknown;
      marketing_support_phone?: unknown;
      marketing_legal_guidelines?: unknown;
    };
    const raw = row.open_facts;
    const facts = Array.isArray(raw) ? raw.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    const supportPhone = String(row.marketing_support_phone ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 48);
    const legalRaw = Array.isArray(row.marketing_legal_guidelines)
      ? row.marketing_legal_guidelines.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
      : [];
    const legalGuidelines =
      legalRaw.length > 0 ? legalRaw : DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES;
    return { facts, supportPhone, legalGuidelines };
  } catch {
    return {
      facts: [],
      supportPhone: "",
      legalGuidelines: DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES,
    };
  }
}

/** טקסטים מהפלואו לשימוש זואי אחרי סיום הפלואו — לפי סדר יצירת הנודים */
const MARKETING_AI_FLOW_CONTEXT_MAX_CHARS = 12_000;
const MARKETING_AI_OPEN_FACTS_MAX_CHARS = 8_000;
const MARKETING_AI_LEGAL_MAX_CHARS = 8_000;

async function loadMarketingNodesAndEdgesForAi(): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  const { nodes, edges } = await loadFlow();
  return { nodes, edges };
}

function buildMarketingFlowKnowledgeLines(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (!t || t.length > 1_200) return;
    if (seen.has(t)) return;
    seen.add(t);
    lines.push(t);
  };

  for (const node of nodes) {
    const d = node.data as Record<string, unknown>;
    const text = String(d.text ?? "").trim();
    const type = node.type;

    switch (type) {
      case "delay": {
        const sec = clampMarketingDelaySeconds(d.delaySeconds);
        push(`בפלואו יש השהיה של ${sec} שניות לפני המשך.`);
        break;
      }
      case "question": {
        const buttons = Array.isArray(d.buttons)
          ? d.buttons.map((b) => String(b ?? "").trim()).filter(Boolean)
          : [];
        const outEdges = edges.filter((e) => e.source_node_id === node.id);
        const edgeLabels = outEdges.map((e) => decodeEdgeLabel(e.label).trim()).filter(Boolean);
        const opts = [...new Set([...buttons, ...edgeLabels])];
        if (text) push(`בפלואו נשאלת השאלה: ${text}`);
        if (opts.length) push(`אפשרויות מענה בפלואו: ${opts.join(" | ")}`);
        break;
      }
      case "media": {
        const mediaUrl = String(d.mediaUrl ?? "").trim();
        if (text) push(`בפלואו (מדיה) מופיע הטקסט: ${text}`);
        if (mediaUrl && !text) push("בפלואו נשלחת מדיה (תמונה או סרטון) בלי טקסט נלווה.");
        break;
      }
      case "cta": {
        const url = String(d.url ?? "").trim();
        if (text && url) push(`בפלואו — קריאה לפעולה: ${text} (קישור: ${url})`);
        else if (text) push(`בפלואו — קריאה לפעולה: ${text}`);
        else if (url) push(`בפלואו מופיע קישור: ${url}`);
        break;
      }
      case "message":
      case "followup":
      default:
        if (text) push(`בפלואו נשלחת הודעה: ${text}`);
    }
  }

  return lines;
}

function capLinesByTotalChars(lines: string[], maxChars: number): string[] {
  const out: string[] = [];
  let n = 0;
  for (const line of lines) {
    const add = line.length + 1;
    if (n + add > maxChars) break;
    out.push(line);
    n += add;
  }
  return out;
}

/**
 * ענפים IN-SCOPE (כושר / ספורט / תנועה) — לתיעוד ולעזר בפרומפט.
 * שלב 1: רק רשימת שחורה ברורה שולחת תשובה קשיחה (בלי Claude).
 */
export const MARKETING_IN_SCOPE_NICHE_TERMS = [
  "סטודיו כושר",
  "חדר כושר",
  "ג'ים",
  "גים",
  "gym",
  "personal trainer",
  "מאמן אישי",
  "קרוספיט",
  "crossfit",
  "HIIT",
  "hiit",
  "אימון קבוצתי",
  "בוט קאמפ",
  "boot camp",
  "פונקציונלי",
  "יוגה",
  "פילאטיס",
  "מדיטציה",
  "מיינדפולנס",
  "תאי צ'י",
  "טאי צ'י",
  "קיגונג",
  "קראטה",
  "קיקבוקסינג",
  "קיקבוקס",
  "בוקס",
  "ג'ודו",
  "גודו",
  "קונג פו",
  "קונגפו",
  "אקרובטיקה",
  "גימנסטיקה",
  "ברייקדאנס",
  "שחייה",
  "גלישה",
  "קיטסרף",
  "צלילה",
  "טניס",
  "פדל",
  "כדורסל",
  "כדורגל",
  "רכיבה",
  "טיפוס",
  "ריצה",
  "טריאתלון",
  "ספינינג",
  "spinning",
  "ריקוד",
  "בלט",
  "היפ הופ",
  "היפהופ",
  "זומבה",
  "סלסה",
  "כושר",
  "ספורט",
  "תנועה",
  "אימון",
  "מאמן",
  "מאמנת",
  "trx",
  "TRX",
] as const;

const MARKETING_IN_SCOPE_NICHE_RE = new RegExp(
  [
    "סטודיו\\s*כושר",
    "חדר\\s*כושר",
    "מכון\\s*כושר",
    "ג[''']?ים",
    "\\bgym\\b",
    "personal\\s*trainer",
    "מאמן\\s*אישי",
    "מאמן",
    "מאמנת",
    "קרוספיט",
    "cross\\s*fit",
    "crossfit",
    "\\bhiit\\b",
    "אימון\\s*קבוצתי",
    "בוט\\s*קאמפ",
    "boot\\s*camp",
    "פונקציונל",
    "יוגה",
    "פילאטיס",
    "מדיטציה",
    "מיינדפולנס",
    "תאי\\s*צ[''']י",
    "טאי\\s*צ[''']י",
    "קיגונג",
    "קראטה",
    "קיקבוקס",
    "בוקס",
    "ג[''']?ודו",
    "קונג\\s*פו",
    "קונגפו",
    "אקרובטיקה",
    "גימנסטיקה",
    "ברייקדאנס",
    "שחייה",
    "גלישה",
    "קיטסרף",
    "צלילה",
    "טניס",
    "פדל",
    "כדורסל",
    "כדורגל",
    "רכיבה",
    "טיפוס",
    "ריצה",
    "טריאתלון",
    "ספינינג",
    "spinning",
    "ריקוד",
    "בלט",
    "היפ\\s*הופ",
    "היפהופ",
    "זומבה",
    "סלסה",
    "כושר",
    "ספורט",
    "תנועה",
    "אימון",
    "\\btrx\\b",
  ].join("|"),
  "iu"
);

/** שלב 1: רשימה שחורה — מילה ברורה → תשובה קשיחה (מדביר וכד' לא ברשימה → שלב 2 בחוקיות) */
const MARKETING_OFF_NICHE_BLACKLIST_RE =
  /ציפורנ|מניקור|פדיקור|מספרה|קוסמטיק|שיער|בוטיק|מסעד|בית\s*קפה|(?:^|\s)קפה(?:\s|$)|(?:^|\s)בר(?:\s|$)|פאב|חשמלא|אינסטלטור|עורך\s*דין|רואה\s*חשבון|נדל"ן|מתווך\s*נדלן/iu;

export const MARKETING_FITNESS_SCOPE_CLARIFY_QUESTION =
  "העסק שלך קשור לכושר, ספורט, או תנועה?";

export const MARKETING_OFF_NICHE_TRANSFER_INTRO =
  "יש מצב שיש לנו פתרון עבורך, אבל אני אצטרך להעביר אותך לנציגה אנושית שהיא אפילו יותר מבינה ממני :)";

/** נוסח לליד בהעברה לנציג — בלי קישור wa.me (התראה לבעלים ב-template נפרד) */
export async function buildMarketingOffNicheTransferLeadReply(): Promise<string> {
  const { MARKETING_HUMAN_AGENT_LEAD_REPLY } = await import("@/lib/marketing-human-agent");
  return `${MARKETING_OFF_NICHE_TRANSFER_INTRO}\n\n${MARKETING_HUMAN_AGENT_LEAD_REPLY}`;
}

function replyLooksLikeOffNicheTransfer(reply: string): boolean {
  return /פתרון עבורך|נציגה אנושית|יותר מבינה ממני|העבר.*לנציג|כמה שיותר פרטים/i.test(
    String(reply ?? "")
  );
}

export function isInScopeMarketingNicheMessage(userText: string): boolean {
  const raw = String(userText ?? "").trim();
  if (!raw) return false;
  return MARKETING_IN_SCOPE_NICHE_RE.test(raw);
}

export function isOffNicheMarketingLeadMessage(userText: string): boolean {
  const raw = String(userText ?? "").trim();
  if (!raw || raw.length < 3) return false;
  return MARKETING_OFF_NICHE_BLACKLIST_RE.test(raw);
}

async function buildOffNicheTransferReply(_userText: string): Promise<string> {
  return buildMarketingOffNicheTransferLeadReply();
}

/** תשובה קבועה + wa.me — null אם ההודעה לא ברשימה השחורה */
export async function getOffNicheMarketingHardReply(userText: string): Promise<string | null> {
  if (!isOffNicheMarketingLeadMessage(userText)) return null;
  return buildOffNicheTransferReply(userText);
}

function isNegativeFitnessScopeClarifyReply(userText: string): boolean {
  const t = String(userText ?? "").trim().toLowerCase();
  if (!t || t.length > 120) return false;
  return /^(לא|לא+\s*|לא[.\s!,]*$|לא\s*קשור|לא\s*ממש|לא\s*בדיוק|לא\s*בתחום|ענף\s*אחר|לא\s*ספורט|לא\s*כושר|לא\s*תנועה|משהו\s*אחר|אחר\b)/iu.test(
    t
  );
}

function assistantAskedFitnessScopeClarify(
  history: Array<{ role: "user" | "assistant"; content: string }>
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i];
    if (row?.role !== "assistant") continue;
    const c = row.content;
    return (
      c.includes(MARKETING_FITNESS_SCOPE_CLARIFY_QUESTION) ||
      /קשור\s*לכושר,\s*ספורט,\s*או\s*תנועה/i.test(c)
    );
  }
  return false;
}

export type CallMarketingAIOptions = {
  /** לשלב 2 (תשובה שלילית אחרי שאלת הבהרה) ולהיסטוריית שיחה */
  leadPhone?: string;
  /** באמצע פלואו (שאלה פתוחה) — בלי שורת סיום «מוכנים להתחיל» */
  skipPostFlowClosing?: boolean;
};

async function isMarketingPostFlowAiContext(leadPhone: string): Promise<boolean> {
  const phone = normalizePhone(leadPhone);
  if (!phone) return true;
  const admin = createSupabaseAdminClient();
  const session = await loadMarketingFlowSession(admin, phone);
  if (!session) return true;
  if (session.flow_completed || !session.current_node_id) return true;
  const pause = normalizeOpenQPauseState(session.open_q_pause_state);
  return pause === "none";
}

/** מסיר סגירות ישנות מתשובת AI — הסגירה והכפתורים נשלחים בהודעה נפרדת */
function prepareMarketingPostFlowAiReply(text: string): string {
  let s = sanitizeZoeDashes(String(text ?? "").trim());

  const lines = s.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  while (lines.length > 0) {
    const last = lines[lines.length - 1] ?? "";
    if (
      /^(יש\s+(עוד\s+)?שאלה|יש\s+לך\s+שאלות|אפשר\s+להנעות|להנעות|מוכנים\s+להתחיל)/iu.test(last) &&
      last.length < 140
    ) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

async function sendMarketingPostFlowActionMenu(phone: string): Promise<void> {
  const interactive = buildMetaInteractivePayload(MARKETING_POST_FLOW_CLOSING_LINE, [
    MARKETING_POST_FLOW_BTN_CHECKOUT,
    MARKETING_POST_FLOW_BTN_MORE_Q,
    MARKETING_POST_FLOW_BTN_HUMAN,
  ]);
  if (interactive) {
    await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, interactive);
    await logMarketingWhatsAppMessage({
      leadPhone: phone,
      role: "assistant",
      content: `${MARKETING_POST_FLOW_CLOSING_LINE}\n[כפתורים: ${MARKETING_POST_FLOW_BTN_CHECKOUT} | ${MARKETING_POST_FLOW_BTN_MORE_Q} | ${MARKETING_POST_FLOW_BTN_HUMAN}]`,
      model_used: "marketing_post_flow_menu",
    });
    return;
  }
  const fallback = [
    MARKETING_POST_FLOW_CLOSING_LINE,
    `1. ${MARKETING_POST_FLOW_BTN_CHECKOUT}`,
    `2. ${MARKETING_POST_FLOW_BTN_MORE_Q}`,
    `3. ${MARKETING_POST_FLOW_BTN_HUMAN}`,
  ].join("\n");
  await sendMarketingWhatsApp(phone, fallback, { model_used: "marketing_post_flow_menu" });
}

/** לחיצה על כפתורי תפריט אחרי סיום הפלואו */
async function tryHandleMarketingPostFlowMenuReply(phone: string, userText: string): Promise<boolean> {
  if (!(await isMarketingPostFlowAiContext(phone))) return false;

  if (labelMatchesChoice(userText, MARKETING_POST_FLOW_BTN_CHECKOUT)) {
    const url = MARKETING_POST_FLOW_CHECKOUT_URL;
    const body = "מעולה! להמשך לסליקה והקמת זואי:";
    const { buildMetaCtaUrlOutgoing } = await import("@/lib/whatsapp");
    const cta = buildMetaCtaUrlOutgoing(body, MARKETING_POST_FLOW_CHECKOUT_CTA_LABEL, url);
    try {
      await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, cta);
      await logMarketingWhatsAppMessage({
        leadPhone: phone,
        role: "assistant",
        content: `${body}\n[${MARKETING_POST_FLOW_CHECKOUT_CTA_LABEL}: ${url}]`,
        model_used: "marketing_post_flow_checkout",
      });
    } catch (e) {
      console.warn("[marketing-flow] post-flow checkout cta_url failed, plain text:", e);
      await sendMarketingWhatsApp(phone, `${body}\n${url}`, { model_used: "marketing_post_flow_checkout" });
    }
    try {
      const { insertLpAnalyticsEvent } = await import("@/lib/lp-analytics");
      void insertLpAnalyticsEvent({
        event_type: "checkout_start",
        session_id: marketingWaSessionId(phone),
        source: "wa_marketing",
        label: "post_flow_menu",
      });
    } catch {
      /* noop */
    }
    return true;
  }

  if (labelMatchesChoice(userText, MARKETING_POST_FLOW_BTN_MORE_Q)) {
    await sendMarketingWhatsApp(phone, MARKETING_POST_FLOW_MORE_Q_REPLY, {
      model_used: "marketing_post_flow_more_q",
    });
    return true;
  }

  if (labelMatchesChoice(userText, MARKETING_POST_FLOW_BTN_HUMAN)) {
    const { handleMarketingHumanAgentRequest } = await import("@/lib/marketing-human-agent");
    await handleMarketingHumanAgentRequest(phone, { forceLeadMessage: true });
    return true;
  }

  return false;
}

/** תשובת AI אחרי פלואו + תפריט כפתורים קבוע */
export async function deliverMarketingPostFlowAiResponse(phoneRaw: string, userText: string): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;

  const { tryHandleMarketingHumanAgentInbound } = await import("@/lib/marketing-human-agent");
  if (await tryHandleMarketingHumanAgentInbound(phone, userText)) return;

  const reply = await callMarketingAI(userText, { leadPhone: phone });
  if (reply.trim()) {
    await sendMarketingWhatsApp(phone, reply, { model_used: "marketing_ai" });
  }
  await sendMarketingPostFlowActionMenu(phone);
}

/**
 * AI fallback for returning users whose flow is complete.
 */
export async function callMarketingAI(
  userText: string,
  opts?: CallMarketingAIOptions
): Promise<string> {
  const { isHeyzoeOwnerOptInMessage } = await import("@/lib/notifications/owner-opt-in");
  if (isHeyzoeOwnerOptInMessage(userText)) {
    return "קיבלנו את בקשת חיבור ההתראות. אם לא קיבלתם אישור — שלחו שוב את הקישור מהדשבורד (HEYZOE_OWNER_שם-העסק).";
  }

  const offNicheReply = await getOffNicheMarketingHardReply(userText);
  if (offNicheReply) {
    console.info("[marketing-flow] off-niche blacklist hard reply (no Claude)");
    const leadPhone = String(opts?.leadPhone ?? "").trim();
    if (leadPhone) {
      const { applyMarketingHumanAgentSideEffects } = await import("@/lib/marketing-human-agent");
      void applyMarketingHumanAgentSideEffects(leadPhone);
    }
    return sanitizeZoeDashes(offNicheReply);
  }

  const leadPhone = String(opts?.leadPhone ?? "").trim();
  if (leadPhone) {
    const { isMarketingHumanAgentRequest, handleMarketingHumanAgentRequest } = await import(
      "@/lib/marketing-human-agent"
    );
    if (isMarketingHumanAgentRequest(userText)) {
      await handleMarketingHumanAgentRequest(leadPhone);
      return "";
    }
  }

  let chatHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (leadPhone) {
    chatHistory = await fetchRecentSessionMessages({
      business_slug: MARKETING_CONVERSATIONS_SLUG,
      session_id: marketingWaSessionId(leadPhone),
      limit: 10,
    });
    if (
      isNegativeFitnessScopeClarifyReply(userText) &&
      assistantAskedFitnessScopeClarify(chatHistory)
    ) {
      console.info("[marketing-flow] negative fitness-scope clarify → transfer (no Claude)");
      const { applyMarketingHumanAgentSideEffects } = await import("@/lib/marketing-human-agent");
      void applyMarketingHumanAgentSideEffects(leadPhone);
      return sanitizeZoeDashes(await buildMarketingOffNicheTransferLeadReply());
    }
  }

  const { resolveClaudeApiKey, CLAUDE_WHATSAPP_MODEL, CLAUDE_WHATSAPP_MAX_TOKENS, isRetryableClaudeError, formatUserFacingClaudeError, sleepMs } = await import("@/lib/claude");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return "אין לי אפשרות לענות כרגע, נחזור אליך בהקדם!";

  const [{ facts: factLines, supportPhone, legalGuidelines }, { nodes, edges }] = await Promise.all([
    loadMarketingAiSettings(),
    loadMarketingNodesAndEdgesForAi(),
  ]);

  const rawFlowLines = buildMarketingFlowKnowledgeLines(nodes, edges);
  const flowLines = capLinesByTotalChars(rawFlowLines, MARKETING_AI_FLOW_CONTEXT_MAX_CHARS);
  const cappedOpenFacts = capLinesByTotalChars(factLines, MARKETING_AI_OPEN_FACTS_MAX_CHARS);
  const legalCapped = capLinesByTotalChars(legalGuidelines, MARKETING_AI_LEGAL_MAX_CHARS);

  const legalAppendix =
    legalCapped.length > 0
      ? `\n\nחוקיות והנחיות:\n${legalCapped.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "";

  const flowAppendix =
    flowLines.length > 0
      ? `\n\nתוכן מפלואו השיווק (הודעות, שאלות, אפשרויות מענה וקישורים — כפי שנשלחים למשתמשים; עני על בסיס זה כשזה רלוונטי, בלי לחזור על כל הפלואו):\n${flowLines.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "";
  const openFactsAppendix =
    cappedOpenFacts.length > 0
      ? `\n\nעובדות ושאלות פתוחות מההגדרות (בנוסף לפלואו למעלה אם יש; אל תמציאי מידע שלא מופיע כאן או בפלואו):\n${cappedOpenFacts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "";
  const trimmedPhone = supportPhone.trim();
  const supportPrefill = supportWhatsAppPrefillFromUserMessage(userText);
  const supportWaUrl = trimmedPhone ? buildMarketingSupportWaUrl(trimmedPhone, supportPrefill) : null;

  const { MARKETING_HUMAN_AGENT_LEAD_REPLY } = await import("@/lib/marketing-human-agent");
  const humanHandoffAppendix = `\n\nהעברה לנציג אנושי (עסק מחוץ לכושר/ספורט/תנועה, תשובה שלילית ל«העסק קשור לכושר, ספורט, או תנועה?», או בקשת נציג):
אל תשלחי קישור wa.me ולא מספר טלפון. השרת שולח לליד במדויק:
${MARKETING_OFF_NICHE_TRANSFER_INTRO}

${MARKETING_HUMAN_AGENT_LEAD_REPLY}
ובמקביל מודיע לצוות HeyZoe.`;

  const supportAppendix = supportWaUrl
    ? `\n\nקישור וואטסאפ לשירות טכני/כללי (רק לשאלות מערכת שלא דורשות העברה לנציג — העתיקי בשורה נפרדת בדיוק):
${supportWaUrl}

חובה: אל תציגי מספר טלפון גולמי. אל תשתמשי בקישור זה כשמבקשים נציג אנושי או כשהעסק מחוץ לנישת כושר/ספורט.`
    : "";
  const systemPrompt =
    MARKETING_CORE_IDENTITY +
    legalAppendix +
    flowAppendix +
    openFactsAppendix +
    humanHandoffAppendix +
    supportAppendix;

  const client = new Anthropic({ apiKey });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const claudeMessages: Array<{ role: "user" | "assistant"; content: string }> =
        chatHistory.length > 0
          ? [...chatHistory]
          : [{ role: "user" as const, content: userText }];
      const last = claudeMessages[claudeMessages.length - 1];
      if (
        !last ||
        last.role !== "user" ||
        String(last.content ?? "").trim() !== userText.trim()
      ) {
        claudeMessages.push({ role: "user", content: userText });
      }

      const response = await client.messages.create({
        model: CLAUDE_WHATSAPP_MODEL,
        max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
        system: systemPrompt,
        messages: claudeMessages,
      });

      const textBlock = response.content.find((b) => b.type === "text");
      let out = sanitizeZoeDashes(textBlock?.text?.trim() || "תודה על ההודעה! נחזור אליך בהקדם.");
      if (
        (isNegativeFitnessScopeClarifyReply(userText) &&
          assistantAskedFitnessScopeClarify(chatHistory)) ||
        replyLooksLikeOffNicheTransfer(out)
      ) {
        out = await buildMarketingOffNicheTransferLeadReply();
        const { applyMarketingHumanAgentSideEffects } = await import("@/lib/marketing-human-agent");
        void applyMarketingHumanAgentSideEffects(leadPhone);
      }
      if (!opts?.skipPostFlowClosing && leadPhone) {
        const postFlow = await isMarketingPostFlowAiContext(leadPhone);
        if (postFlow) out = prepareMarketingPostFlowAiReply(out);
      }
      return sanitizeZoeDashes(out);
    } catch (e) {
      if (attempt === 0 && isRetryableClaudeError(e)) {
        await sleepMs(1500);
        continue;
      }
      console.error("[marketing-flow] Claude error:", e);
      return sanitizeZoeDashes(formatUserFacingClaudeError(e));
    }
  }

  return sanitizeZoeDashes("תודה על ההודעה! נחזור אליך בהקדם.");
}
