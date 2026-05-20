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

type Session = {
  id: string;
  phone: string;
  current_node_id: string | null;
  flow_completed: boolean;
};

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

/**
 * Decode edge label — may contain JSON with sourceHandle info.
 */
function decodeEdgeLabel(raw: string): string {
  const s = String(raw ?? "");
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { _mf?: number; t?: string };
      if (o && o._mf === 1) return String(o.t ?? "");
    } catch { /* plain text */ }
  }
  return s;
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
    const normalized = userText.trim().toLowerCase();
    const edgeLabel = (e: FlowEdge) => decodeEdgeLabel(e.label).trim().toLowerCase();
    const matched =
      outEdges.find((e) => {
        const label = edgeLabel(e);
        return label && normalized === label;
      }) ??
      outEdges.find((e) => {
        const label = edgeLabel(e);
        return label && normalized.includes(label);
      });
    const targetId = matched?.target_node_id ?? outEdges[0]!.target_node_id;
    return nodes.find((n) => n.id === targetId) ?? null;
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
 * - Flow in progress at question → advance only if reply matches a button/option; else AI
 * - Flow completed → return false (caller should use Zoe AI)
 */
export async function handleMarketingFlowInbound(
  phoneRaw: string,
  userText: string
): Promise<{ handled: boolean }> {
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

  const admin = createSupabaseAdminClient();
  const { nodes, edges, isActive } = await loadFlow();

  if (!isActive || nodes.length === 0) {
    return { handled: false };
  }

  const startFlowMessage = isMarketingFlowStartMessage(userText);

  const { data: session } = await admin
    .from("marketing_flow_sessions")
    .select("id, phone, current_node_id, flow_completed")
    .eq("phone", phone)
    .maybeSingle();

  if (startFlowMessage) {
    await admin.from("marketing_flow_sessions").delete().eq("phone", phone);
    console.info("[marketing-flow] flow start/restart for:", phone, { hadSession: Boolean(session) });

    const startNode = findStartNode(nodes, edges);
    if (!startNode) return { handled: false };

    const { waitingForAnswer, nextNodeId } = await sendNodeChain(startNode, phone, edges, nodes);

    await admin.from("marketing_flow_sessions").upsert(
      {
        phone,
        current_node_id: nextNodeId,
        flow_completed: !waitingForAnswer && !nextNodeId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone" }
    );

    if (!session) {
      const { trackWaNewLead } = await import("@/lib/admin-marketing-analytics");
      void trackWaNewLead(phone);
    }

    return { handled: true };
  }

  if (!session) {
    return { handled: false };
  }

  const sess = session as unknown as Session;

  if (sess.flow_completed || !sess.current_node_id) {
    return { handled: false };
  }

  const currentNode = nodes.find((n) => n.id === sess.current_node_id);
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
  if (currentNode.type === "question") {
    if (!matchesMarketingFlowQuestionAnswer(currentNode, edges, userText)) {
      console.info("[marketing-flow] open question during flow — deferring to AI", {
        phone,
        nodeId: currentNode.id,
      });
      return { handled: false };
    }
    nextNode = findNextNode(currentNode.id, edges, nodes, userText);
  } else {
    nextNode = findNextNode(currentNode.id, edges, nodes);
  }

  if (!nextNode) {
    await admin.from("marketing_flow_sessions").update({
      flow_completed: true,
      current_node_id: null,
      updated_at: new Date().toISOString(),
    }).eq("id", sess.id);
    return { handled: false };
  }

  const { waitingForAnswer, nextNodeId } = await sendNodeChain(nextNode, phone, edges, nodes);

  await admin.from("marketing_flow_sessions").update({
    current_node_id: nextNodeId,
    flow_completed: !waitingForAnswer && !nextNodeId,
    updated_at: new Date().toISOString(),
  }).eq("id", sess.id);

  return { handled: true };
}

const MARKETING_CORE_IDENTITY = `את זואי — עוזרת AI חכמה של HeyZoe.
HeyZoe היא פלטפורמה שמאפשרת לבעלי עסקים (סטודיו, מאמנים, מטפלים) לחבר עוזרת AI בוואטסאפ שעונה ללידים שלהם 24/7, מטפלת בשאלות חוזרות, ומקדמת אותם להרשמה.

קראי את כל סעיפי החוקיות, העובדות וההנחיות המופיעים בהמשך בהודעת המערכת, והתנהגי בהתאם — במיוחד כללי העברית התקנית, הפורמט לוואטסאפ והטון.

סגנון אחרי הפלואו (כשהליד כותב חופשי):
- עני ישירות לנושא שהמשתמש העלה (אם כתב על קרוספיט — עני על לידים/מענה/ניסיון באותו הקשר; אל תסטי לנושאים כלליים או מטאפורות לא קשורות כמו ״תעלומה״, ״משימה״, ״הרפתקה״).
- טון עסקי־חם: לא סלנג היפר (לא ״יאללה״, לא ״אז אומר לך״ או פתיחים ריקים). עדיף משפט ראשון שמזהה את דבריהם או שאלה עניינית קצרה.
- בלי דימויים מוזרים או בדיחות שלא קשורות ל־HeyZoe או לשאלה.`;

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

export const MARKETING_OFF_NICHE_TRANSFER_CLOSING =
  "שלחו להם הודעה ויחזרו אליכם בקרוב :)";

export function formatMarketingOffNicheTransferReply(waUrl: string | null): string {
  if (!waUrl) {
    return `${MARKETING_OFF_NICHE_TRANSFER_INTRO}\n\n${MARKETING_OFF_NICHE_TRANSFER_CLOSING}`;
  }
  return `${MARKETING_OFF_NICHE_TRANSFER_INTRO}\n\n${waUrl}\n\n${MARKETING_OFF_NICHE_TRANSFER_CLOSING}`;
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

async function buildOffNicheTransferReply(userText: string): Promise<string> {
  const { supportPhone } = await loadMarketingAiSettings();
  const prefill = supportWhatsAppPrefillFromUserMessage(userText);
  const waUrl = supportPhone.trim()
    ? buildMarketingSupportWaUrl(supportPhone.trim(), prefill)
    : null;

  if (!waUrl) {
    console.warn("[marketing-flow] off-niche transfer but marketing_support_phone is missing");
  }

  return formatMarketingOffNicheTransferReply(waUrl);
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

/** זיהוי גס לבקשת מענה אנושי — משלים את הפרומפט אם המודל דילג על קישור הוואטסאפ */
function userAsksForHumanAgent(userText: string): boolean {
  const raw = String(userText ?? "").trim();
  if (!raw) return false;
  const t = raw.toLowerCase();
  const hebrew =
    /נציג|נציגה|בן\s*אדם|אדם\s*אמיתי|מענה\s*אנושי|דברו\s*איתי|לדבר\s*עם\s*מישהו|לדבר\s*עם\s*אדם|העבר(ה|י)\s*ל|תחבר(ו|י)\s*אותי|אפשר\s*לדבר\s*עם|מישהו\s*אמיתי|נציג\s*אנושי|שירות\s*אנושי|לא\s*רובוט|לא\s*בוט|עם\s*בשר\s*ודם|(אני\s*)?(רוצה|צריך|צריכה|מעוניין|מעוניינת|מבקש|מבקשת).{0,50}שירות\s*לקוחות|שירות\s*לקוחות.{0,20}(בבקשה|עכשיו)/i.test(
      raw
    );
  const english =
    /\b(human|agent|representative|real\s*person|customer\s*service|talk\s*to\s*(a\s*)?(human|person|someone)|speak\s*to\s*(a\s*)?(human|person))\b/i.test(
      t
    );
  return hebrew || english;
}

export type CallMarketingAIOptions = {
  /** לשלב 2 (תשובה שלילית אחרי שאלת הבהרה) ולהיסטוריית שיחה */
  leadPhone?: string;
};

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
    return sanitizeZoeDashes(offNicheReply);
  }

  const leadPhone = String(opts?.leadPhone ?? "").trim();
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
      return sanitizeZoeDashes(await buildOffNicheTransferReply(userText));
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

  const supportAppendix = supportWaUrl
    ? `\n\nקישור וואטסאפ לשירות לקוחות אנושי (העתיקי בשורה נפרדת בדיוק כפי שמופיע, בלי לשנות):
${supportWaUrl}

חובה: אל תציגי מספר טלפון גולמי. הפניה לשירות — רק עם קישור wa.me כמו למעלה.

נוסח חובה להעברה לנציג (עסק מחוץ לכושר/ספורט/תנועה, תשובה שלילית לשאלת «העסק קשור לכושר, ספורט, או תנועה?», או בקשת נציג אנושי) — העתיקי במדויק, שורות נפרדות, בלי לשנות מילה ובלי «כמה שיותר פרטים»:
${MARKETING_OFF_NICHE_TRANSFER_INTRO}

${supportWaUrl}

${MARKETING_OFF_NICHE_TRANSFER_CLOSING}

כשאין תשובה בעובדות (מערכת, תנאים, חיובים, תקלה טכנית) ואין צורך בהעברה לנציג — עני בקצרה והפנילי לפתוח את הקישור למעלה; בוואטסאפ ייטען טקסט פתיחה קצר (אפשר לערוך לפני השליחה). אל תשתמשי בנוסח ההעברה למעלה במקרים האלה.`
    : "";
  const systemPrompt =
    MARKETING_CORE_IDENTITY + legalAppendix + flowAppendix + openFactsAppendix + supportAppendix;

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
        supportWaUrl &&
        (userAsksForHumanAgent(userText) ||
          (isNegativeFitnessScopeClarifyReply(userText) &&
            assistantAskedFitnessScopeClarify(chatHistory)) ||
          replyLooksLikeOffNicheTransfer(out))
      ) {
        out = formatMarketingOffNicheTransferReply(supportWaUrl);
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
