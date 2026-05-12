import { createSupabaseAdminClient } from "@/lib/supabase-admin";
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
 * Handle an inbound message on the marketing line.
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

  if (!session) {
    const startNode = findStartNode(nodes, edges);
    if (!startNode) return { handled: false };

    await sendNodeMessage(startNode, phone);

    const nextNode = findNextNode(startNode.id, edges, nodes);
    await admin.from("marketing_flow_sessions").insert({
      phone,
      current_node_id: startNode.type === "question" ? startNode.id : (nextNode?.id ?? null),
      flow_completed: !nextNode && startNode.type !== "question",
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

  if (nextNode) {
    await sendNodeMessage(nextNode, phone);

    const followingNode = findNextNode(nextNode.id, edges, nodes);
    await admin.from("marketing_flow_sessions").update({
      current_node_id: nextNode.type === "question" ? nextNode.id : (followingNode?.id ?? null),
      flow_completed: !followingNode && nextNode.type !== "question",
      updated_at: new Date().toISOString(),
    }).eq("id", sess.id);
  } else {
    await admin.from("marketing_flow_sessions").update({
      flow_completed: true,
      current_node_id: null,
      updated_at: new Date().toISOString(),
    }).eq("id", sess.id);
  }

  return { handled: !!nextNode };
}

const MARKETING_SYSTEM_PROMPT = `את זואי — עוזרת AI חכמה של HeyZoe.
HeyZoe היא פלטפורמה שמאפשרת לבעלי עסקים (סטודיו, מאמנים, מטפלים) לחבר עוזרת AI בוואטסאפ שעונה ללידים שלהם 24/7, מטפלת בשאלות חוזרות, ומקדמת אותם להרשמה.

כשמישהו שולח הודעה:
- ענו בעברית, בטון חם, קצר וידידותי
- אם שואלים על HeyZoe — הסבירו בקצרה מה זה ואיך זה עוזר
- אם שואלים שאלה טכנית — כוונו אותם לצוות שלנו
- אם זו סתם שיחה — היו נחמדות ומזמינות
- אל תמציאו מחירים או תכונות שלא הוזכרו
- שמרו על הודעות קצרות (2-3 משפטים מקס)`;

/**
 * AI fallback for returning users whose flow is complete.
 */
export async function callMarketingAI(userText: string): Promise<string> {
  const { resolveClaudeApiKey, CLAUDE_WHATSAPP_MODEL, CLAUDE_WHATSAPP_MAX_TOKENS, isRetryableClaudeError, formatUserFacingClaudeError, sleepMs } = await import("@/lib/claude");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return "אין לי אפשרות לענות כרגע, נחזור אליך בהקדם!";

  const client = new Anthropic({ apiKey });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: CLAUDE_WHATSAPP_MODEL,
        max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
        system: MARKETING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userText }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.text?.trim() || "תודה על ההודעה! נחזור אליך בהקדם.";
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
