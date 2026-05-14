import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES } from "@/lib/marketing-zoe-legal-defaults";
import { clampMarketingDelaySeconds } from "@/lib/marketing-flow-delay";
import {
  sendMetaWhatsAppMessage,
  buildMetaInteractivePayload,
  type MetaWhatsAppOutgoing,
} from "@/lib/whatsapp";

const MARKETING_META_PHONE_NUMBER_ID = "1179786855208358";

type FlowNode = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

type FlowEdge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  label: string;
};

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
export async function isFirstContact(phone: string): Promise<boolean> {
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
  const admin = createSupabaseAdminClient();
  const [{ data: nodes }, { data: edges }, { data: settings }] = await Promise.all([
    admin.from("marketing_flow_nodes").select("id, type, data").order("created_at", { ascending: true }),
    admin.from("marketing_flow_edges").select("id, source_node_id, target_node_id, label").order("id", { ascending: true }),
    admin.from("marketing_flow_settings").select("is_active").eq("id", 1).maybeSingle(),
  ]);
  return {
    nodes: (nodes ?? []) as unknown as FlowNode[],
    edges: (edges ?? []) as unknown as FlowEdge[],
    isActive: Boolean((settings as { is_active?: boolean } | null)?.is_active),
  };
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
    const matched = outEdges.find((e) => {
      const label = decodeEdgeLabel(e.label).trim().toLowerCase();
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
      await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, { type: "text", text });
      break;
    }
    case "question": {
      const buttons = Array.isArray(data.buttons) ? data.buttons.map((b: unknown) => String(b ?? "").trim()).filter(Boolean) : [];
      if (buttons.length >= 2) {
        const interactive = buildMetaInteractivePayload(text || "בחרו אפשרות:", buttons);
        if (interactive) {
          await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, interactive);
          return;
        }
      }
      if (text) await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, { type: "text", text });
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
          const url = `https://graph.facebook.com/v21.0/${MARKETING_META_PHONE_NUMBER_ID}/messages`;
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
          if (text) await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, { type: "text", text });
        }
        void mediaOutgoing;
      } else if (text) {
        await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, { type: "text", text });
      }
      break;
    }
    case "cta": {
      const ctaUrl = String(data.url ?? "").trim();
      if (ctaUrl && text) {
        const { buildMetaCtaUrlOutgoing } = await import("@/lib/whatsapp");
        const outgoing = buildMetaCtaUrlOutgoing(text, "לחצו כאן", ctaUrl);
        await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, outgoing);
      } else if (text) {
        await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, { type: "text", text });
      }
      break;
    }
    default: {
      if (text) await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, { type: "text", text });
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

const GREETING_RE =
  /^(היוש|הייי+|היי|הי|אהלן|שלום|בוקר טוב|ערב טוב|הלו|hello|hi|hey|שלומות|מה נשמע|מה קורה)\s*[.!?]*$/iu;

function isGreeting(text: string): boolean {
  return GREETING_RE.test(text.trim());
}

/**
 * Handle an inbound message on the marketing line.
 * - Greeting message → reset session, start flow from beginning
 * - First contact → start the flow from the first node
 * - Flow in progress → advance to the next node based on the user's reply
 * - Flow completed → return false (caller should use Zoe AI)
 */
export async function handleMarketingFlowInbound(
  phone: string,
  userText: string
): Promise<{ handled: boolean }> {
  const admin = createSupabaseAdminClient();
  const { nodes, edges, isActive } = await loadFlow();

  if (!isActive || nodes.length === 0) {
    return { handled: false };
  }

  const { data: session } = await admin
    .from("marketing_flow_sessions")
    .select("id, phone, current_node_id, flow_completed")
    .eq("phone", phone)
    .maybeSingle();

  if (session && isGreeting(userText)) {
    await admin.from("marketing_flow_sessions").delete().eq("id", (session as unknown as Session).id);
    console.info("[marketing-flow] greeting reset for:", phone);
  }

  if (!session || isGreeting(userText)) {
    const startNode = findStartNode(nodes, edges);
    if (!startNode) return { handled: false };

    const { waitingForAnswer, nextNodeId } = await sendNodeChain(startNode, phone, edges, nodes);

    await admin.from("marketing_flow_sessions").insert({
      phone,
      current_node_id: nextNodeId,
      flow_completed: !waitingForAnswer && !nextNodeId,
    });

    return { handled: true };
  }

  const sess = session as unknown as Session;

  if (sess.flow_completed || !sess.current_node_id) {
    return { handled: false };
  }

  const currentNode = nodes.find((n) => n.id === sess.current_node_id);
  if (!currentNode) {
    await admin.from("marketing_flow_sessions").update({ flow_completed: true, updated_at: new Date().toISOString() }).eq("id", sess.id);
    return { handled: false };
  }

  let nextNode: FlowNode | null;
  if (currentNode.type === "question") {
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

קראי את כל סעיפי החוקיות, העובדות וההנחיות המופיעים בהמשך בהודעת המערכת, והתנהגי בהתאם.

עברית ופנייה לליד:
- דיוק תחבירי: בדקי חיבור עם ״ש־״ ומילות יחס (למשל לא ״לעזור לך עם״ בלי השלמה; עדיף ״לעזור לך איתו?״, ״שאוכל לעזור לך בזה?״, ״יש משהו שאוכל לעזור לך איתו?״).
- ניסוח נייטרלי: אל תניחי שהשולח זכר או נקבה. בלי ״אתה״/״את״ אם לא נכתב במפורש. עדיף ״ואיך אצלך?״, ״מה נשמע?״ — לא ״מה שלומך אתה?״

סגנון אחרי הפלואו (כשהליד כותב חופשי):
- עני ישירות לנושא שהמשתמש העלה (אם כתב על קרוספיט — עני על לידים/מענה/ניסיון באותו הקשר; אל תסטי לנושאים כלליים או מטאפורות לא קשורות כמו ״תעלומה״, ״משימה״, ״הרפתקה״).
- טון עסקי־חם: לא סלנג היפר (לא ״יאללה״, לא ״אז אומר לך״ או פתיחים ריקים). עדיף משפט ראשון שמזהה את דבריהם או שאלה עניינית קצרה.
- בלי דימויים מוזרים או בדיחות שלא קשורות ל־HeyZoe או לשאלה.
- אימוג׳י לכל היותר אחד בסוף אם באמת מתאים; רוב התשובות בלי אימוג׳י.`;

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
  try {
    const admin = createSupabaseAdminClient();
    const [{ data: nodes }, { data: edges }] = await Promise.all([
      admin.from("marketing_flow_nodes").select("id, type, data").order("created_at", { ascending: true }),
      admin.from("marketing_flow_edges").select("id, source_node_id, target_node_id, label").order("id", { ascending: true }),
    ]);
    return {
      nodes: (nodes ?? []) as unknown as FlowNode[],
      edges: (edges ?? []) as unknown as FlowEdge[],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
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

/** זיהוי גס לבקשת מענה אנושי — משלים את הפרומפט אם המודל דילג על המספר */
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

function replyContainsSupportPhoneDigits(reply: string, phone: string): boolean {
  const digitsPhone = String(phone).replace(/\D/g, "");
  if (digitsPhone.length < 6) return reply.includes(phone.trim());
  const digitsReply = reply.replace(/\D/g, "");
  if (digitsReply.includes(digitsPhone)) return true;
  const tail = digitsPhone.slice(-9);
  return tail.length >= 7 && digitsReply.includes(tail);
}

/**
 * AI fallback for returning users whose flow is complete.
 */
export async function callMarketingAI(userText: string): Promise<string> {
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
  const supportAppendix =
    trimmedPhone.length > 0
      ? `\n\nמספר שירות לקוחות אנושי להפניה: ${trimmedPhone}

חובה מוחלטת: אם השולח מבקש בכל ניסוח (עברית או אנגלית) לדבר עם נציג אנושי, נציג, בן אדם, אדם אמיתי, שירות לקוחות אנושי, מענה אנושי, לדבר עם מישהו, representative, agent, human, customer service person, real person וכו׳ — חייבת להופיע בהודעת התשובה שלך את מספר השירות למעלה באופן בולט (למשל שורה נפרדת עם המספר), יחד עם משפט חם קצר.

כשהשאלה נוגעת לשימוש במערכת HeyZoe, תנאי שימוש, מחירים וחיובים, תקלות טכניות, או כל נושא שאין עליו תשובה ברורה בעובדות למעלה — אל תמציאי מידע. עני בקצרה (עד 2–3 משפטים), בנימוס, והפנילי את השולח ליצור קשר ישירות במספר הזה (וואטסאפ או טלפון — לפי הפורמט שמוצג).`
      : "";
  const systemPrompt =
    MARKETING_CORE_IDENTITY + legalAppendix + flowAppendix + openFactsAppendix + supportAppendix;

  const client = new Anthropic({ apiKey });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: CLAUDE_WHATSAPP_MODEL,
        max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userText }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      let out = textBlock?.text?.trim() || "תודה על ההודעה! נחזור אליך בהקדם.";
      if (
        trimmedPhone &&
        userAsksForHumanAgent(userText) &&
        !replyContainsSupportPhoneDigits(out, trimmedPhone)
      ) {
        out = `${out}\n\n${trimmedPhone}`;
      }
      return out;
    } catch (e) {
      if (attempt === 0 && isRetryableClaudeError(e)) {
        await sleepMs(1500);
        continue;
      }
      console.error("[marketing-flow] Claude error:", e);
      return formatUserFacingClaudeError(e);
    }
  }

  return "תודה על ההודעה! נחזור אליך בהקדם.";
}
