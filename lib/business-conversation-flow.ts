import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { CLAUDE_WHATSAPP_MODEL } from "@/lib/claude";
import { resolveClaudeApiKey } from "@/lib/server-env";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import { HEYZOE_SF_SERVICE_PREFIX, logMessage } from "@/lib/analytics";
import { buildMetaInteractivePayload, sendMetaWhatsAppMessage } from "@/lib/whatsapp";
import { stripModelThoughtLeak } from "@/lib/wa-model-thought-strip";
import { markContactTrialRegisteredManually } from "@/lib/trial-registered-manual";
import { fillRegistrationText, matchQuestionButton } from "@/lib/business-conversation-flow-text";
import { businessOpensSalesFlowOnAnyNewLeadMessage } from "@/lib/sales-flow-start-triggers";
import { markContactSalesFlowStarted } from "@/lib/contacts-sales-flow-started";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { clampWaReplyButtonTitle } from "@/lib/wa-button-label";
import {
  serviceMetaFromDescription,
  weeklyScheduleSlotButtons,
  type WeeklyScheduleButton,
} from "@/lib/product-schedule-slots";

export type BusinessFlowNodeType = "message" | "question" | "product" | "daytime" | "register";

type FlowNode = {
  id: string;
  type: BusinessFlowNodeType;
  data: Record<string, unknown>;
};

type FlowEdge = {
  source_node_id: string;
  target_node_id: string;
  source_handle: string;
};

type FlowSession = {
  id: string;
  current_node_id: string | null;
  flow_completed: boolean;
  product_slug: string;
  captured_day: string;
  captured_time: string;
};

const MAX_CHAIN = 12;

function phoneKey(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function nodeText(node: FlowNode): string {
  return String(node.data.text ?? "").trim();
}

const MAX_NODE_BUTTONS = 10;

function fitButtonLabel(raw: unknown): string {
  return clampWaReplyButtonTitle(String(raw ?? "").trim());
}

function questionButtons(node: FlowNode): string[] {
  const raw = node.data.buttons;
  if (!Array.isArray(raw)) return [];
  return raw.map(fitButtonLabel).filter(Boolean).slice(0, MAX_NODE_BUTTONS);
}

function startNode(nodes: FlowNode[], edges: FlowEdge[]): FlowNode | null {
  const targeted = new Set(edges.map((e) => e.target_node_id));
  const roots = nodes.filter((n) => !targeted.has(n.id));
  return roots[0] ?? nodes[0] ?? null;
}

function edgeFrom(edges: FlowEdge[], sourceId: string, handle: string): FlowEdge | null {
  return edges.find((e) => e.source_node_id === sourceId && e.source_handle === handle) ?? null;
}

async function sendText(phoneNumberId: string, phone: string, businessSlug: string, sessionId: string, text: string) {
  const body = text.trim();
  if (!body) return;
  await sendMetaWhatsAppMessage(phoneNumberId, phone, { type: "text", text: body });
  await logMessage({
    business_slug: businessSlug,
    role: "assistant",
    content: body,
    model_used: "business_conversation_flow",
    session_id: sessionId,
  });
}

async function sendChoices(
  phoneNumberId: string,
  phone: string,
  businessSlug: string,
  sessionId: string,
  text: string,
  buttons: string[]
) {
  const body = text.trim() || "בחרו אפשרות";
  const interactive = buttons.length ? buildMetaInteractivePayload(body, buttons) : null;
  if (interactive) {
    await sendMetaWhatsAppMessage(phoneNumberId, phone, interactive);
    await logMessage({
      business_slug: businessSlug,
      role: "assistant",
      content: `${body}\n[כפתורים: ${buttons.join(" | ")}]`,
      model_used: "business_conversation_flow",
      session_id: sessionId,
    });
    return;
  }
  await sendText(phoneNumberId, phone, businessSlug, sessionId, body);
}

async function loadGraph(admin: SupabaseClient, businessId: number): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] } | null> {
  const { data: nodeRows, error: nodeErr } = await admin
    .from("business_conversation_nodes")
    .select("id, type, data, position_y")
    .eq("business_id", businessId)
    .order("position_y", { ascending: true });
  if (nodeErr) {
    if (/business_conversation_nodes|does not exist|schema cache/i.test(nodeErr.message)) return null;
    console.error("[business-conversation-flow] load nodes failed:", nodeErr.message);
    return null;
  }
  const nodes = (nodeRows ?? [])
    .map((row) => ({
      id: String((row as { id?: unknown }).id ?? ""),
      type: String((row as { type?: unknown }).type ?? "") as BusinessFlowNodeType,
      data: ((row as { data?: unknown }).data ?? {}) as Record<string, unknown>,
    }))
    .filter((n) => n.id && (n.type === "message" || n.type === "question" || n.type === "product" || n.type === "daytime" || n.type === "register"));
  if (!nodes.length) return null;

  const { data: edgeRows, error: edgeErr } = await admin
    .from("business_conversation_edges")
    .select("source_node_id, target_node_id, source_handle")
    .eq("business_id", businessId);
  if (edgeErr) {
    console.error("[business-conversation-flow] load edges failed:", edgeErr.message);
    return null;
  }
  const edges = (edgeRows ?? []).map((row) => ({
    source_node_id: String((row as { source_node_id?: unknown }).source_node_id ?? ""),
    target_node_id: String((row as { target_node_id?: unknown }).target_node_id ?? ""),
    source_handle: String((row as { source_handle?: unknown }).source_handle ?? "out") || "out",
  }));
  return { nodes, edges };
}

async function loadSession(admin: SupabaseClient, businessId: number, phone: string): Promise<FlowSession | null> {
  const { data, error } = await admin
    .from("business_conversation_sessions")
    .select("id, current_node_id, flow_completed, product_slug, captured_day, captured_time")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String((data as { id?: unknown }).id ?? ""),
    current_node_id: ((data as { current_node_id?: unknown }).current_node_id as string | null) ?? null,
    flow_completed: (data as { flow_completed?: unknown }).flow_completed === true,
    product_slug: String((data as { product_slug?: unknown }).product_slug ?? ""),
    captured_day: String((data as { captured_day?: unknown }).captured_day ?? ""),
    captured_time: String((data as { captured_time?: unknown }).captured_time ?? ""),
  };
}

async function saveSession(
  admin: SupabaseClient,
  businessId: number,
  phone: string,
  patch: Partial<FlowSession> & { current_node_id?: string | null }
) {
  const row = {
    business_id: businessId,
    phone,
    updated_at: new Date().toISOString(),
    current_node_id: patch.current_node_id ?? null,
    flow_completed: patch.flow_completed === true,
    product_slug: patch.product_slug ?? "",
    captured_day: patch.captured_day ?? "",
    captured_time: patch.captured_time ?? "",
  };
  const { error } = await admin.from("business_conversation_sessions").upsert(row, { onConflict: "business_id,phone" });
  if (error) console.error("[business-conversation-flow] session save failed:", error.message);
}

const SLOT_PICK_PROMPT = "באיזה מועד נוח לך?";

async function weeklySlotsForProduct(
  admin: SupabaseClient,
  businessId: number,
  slug: string
): Promise<WeeklyScheduleButton[]> {
  const clean = slug.trim();
  if (!clean) return [];
  const { data, error } = await admin
    .from("services")
    .select("description")
    .eq("business_id", businessId)
    .eq("service_slug", clean)
    .maybeSingle();
  if (error) {
    console.error("[business-conversation-flow] schedule slots lookup failed:", error.message);
    return [];
  }
  return weeklyScheduleSlotButtons(serviceMetaFromDescription((data as { description?: unknown } | null)?.description)).slice(
    0,
    MAX_NODE_BUTTONS
  );
}

async function productName(admin: SupabaseClient, businessId: number, slug: string): Promise<string> {
  const clean = slug.trim();
  if (!clean) return "";
  const { data } = await admin
    .from("services")
    .select("name")
    .eq("business_id", businessId)
    .eq("service_slug", clean)
    .maybeSingle();
  return String((data as { name?: unknown } | null)?.name ?? "").trim();
}

async function answerFreeQuestion(businessSlug: string, sessionId: string, question: string): Promise<string> {
  const pack = await getBusinessKnowledgePack(businessSlug);
  const knowledge = [pack?.faqsText, pack?.servicesText, pack?.benefitsText, pack?.vibeText, pack?.targetAudienceText]
    .filter(Boolean)
    .join("\n\n");
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return "אני כאן לכל שאלה על האימונים.";
  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: CLAUDE_WHATSAPP_MODEL,
      max_tokens: 280,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: `את זואי, עוזרת של העסק. עני בעברית, קצר ולעניין, רק מתוך הידע. בלי קישור תשלום ובלי לבקש כרטיס אשראי.
ידע:
${knowledge || "אין ידע נוסף."}

שאלה: ${question}`,
        },
      ],
    });
    const text = (resp.content ?? [])
      .map((c) => ("text" in c ? String(c.text ?? "") : ""))
      .join("\n")
      .trim();
    const fallback = "אני כאן, אפשר לשאול אותי עוד.";
    const stripped = stripModelThoughtLeak(text || fallback, {
      businessSlug,
      conversationId: sessionId,
    });
    return stripped.trim() || fallback;
  } catch (e) {
    console.error("[business-conversation-flow] free question failed:", e);
    return "אני כאן לכל שאלה על האימונים.";
  }
}

async function completeRegistration(input: {
  admin: SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  session: FlowSession;
}) {
  const name = await productName(input.admin, input.businessId, input.session.product_slug);
  const { contactPhoneLookupVariants, buildWaSessionId } = await import("@/lib/phone-normalize");
  const variants = contactPhoneLookupVariants(input.phone);
  if (variants.length) {
    await input.admin
      .from("contacts")
      .update({
        sf_requested_date: input.session.captured_day || null,
        sf_requested_time: input.session.captured_time || null,
      })
      .eq("business_id", input.businessId)
      .in("phone", variants);
  }
  const channel = await input.admin
    .from("whatsapp_channels")
    .select("phone_number_id")
    .eq("business_id", input.businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const phoneNumberId = String((channel.data as { phone_number_id?: unknown } | null)?.phone_number_id ?? "").trim();
  const waSessionId = phoneNumberId ? buildWaSessionId(phoneNumberId, input.phone) : "";
  if (name && waSessionId) {
    await logMessage({
      business_slug: input.businessSlug,
      role: "event",
      content: `${HEYZOE_SF_SERVICE_PREFIX} ${name}`,
      model_used: "business_conversation_flow",
      session_id: waSessionId,
    });
  }
  const result = await markContactTrialRegisteredManually({
    admin: input.admin,
    businessId: input.businessId,
    businessSlug: input.businessSlug,
    phone: input.phone,
    scheduleDirectRegistration: false,
  });
  if (!result.ok) {
    console.error("[business-conversation-flow] registration mark failed:", result.error);
  }
}

async function deliverFrom(input: {
  admin: SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  phoneNumberId: string;
  sessionId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  session: FlowSession;
  nodeId: string;
}) {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  let nodeId: string | null = input.nodeId;
  const seen = new Set<string>();
  let session = input.session;

  for (let step = 0; step < MAX_CHAIN && nodeId; step += 1) {
    if (seen.has(nodeId)) break;
    seen.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) break;

    if (node.type === "question") {
      await sendChoices(
        input.phoneNumberId,
        input.phone,
        input.businessSlug,
        input.sessionId,
        nodeText(node),
        questionButtons(node)
      );
      session = { ...session, current_node_id: node.id, flow_completed: false };
      await saveSession(input.admin, input.businessId, phoneKey(input.phone), session);
      return;
    }

    if (node.type === "daytime") {
      const slots = await weeklySlotsForProduct(input.admin, input.businessId, session.product_slug);
      if (!slots.length || (session.captured_day && session.captured_time)) {
        const next = edgeFrom(input.edges, node.id, "out");
        nodeId = next?.target_node_id ?? null;
        continue;
      }
      await sendChoices(
        input.phoneNumberId,
        input.phone,
        input.businessSlug,
        input.sessionId,
        SLOT_PICK_PROMPT,
        slots.map((slot) => slot.label)
      );
      session = { ...session, current_node_id: node.id, flow_completed: false };
      await saveSession(input.admin, input.businessId, phoneKey(input.phone), session);
      return;
    }

    if (node.type === "product") {
      const slug = String(node.data.product_slug ?? "").trim();
      session = { ...session, product_slug: slug || session.product_slug, captured_day: "", captured_time: "" };
      const text = nodeText(node);
      if (text) await sendText(input.phoneNumberId, input.phone, input.businessSlug, input.sessionId, text);
      const next = edgeFrom(input.edges, node.id, "out");
      nodeId = next?.target_node_id ?? null;
      continue;
    }

    if (node.type === "register") {
      const name = await productName(input.admin, input.businessId, session.product_slug);
      const template = nodeText(node) || "רשמתי אותך ל{מוצר} ב{יום} בשעה {שעה}.";
      const text = fillRegistrationText({
        template,
        productName: name,
        day: session.captured_day,
        time: session.captured_time,
      });
      await sendText(input.phoneNumberId, input.phone, input.businessSlug, input.sessionId, text);
      session = { ...session, current_node_id: node.id, flow_completed: true };
      await saveSession(input.admin, input.businessId, phoneKey(input.phone), session);
      await completeRegistration({
        admin: input.admin,
        businessId: input.businessId,
        businessSlug: input.businessSlug,
        phone: input.phone,
        session,
      });
      return;
    }

    const text = nodeText(node);
    if (text) await sendText(input.phoneNumberId, input.phone, input.businessSlug, input.sessionId, text);
    const next = edgeFrom(input.edges, node.id, "out");
    nodeId = next?.target_node_id ?? null;
  }

  await saveSession(input.admin, input.businessId, phoneKey(input.phone), {
    ...session,
    current_node_id: nodeId,
    flow_completed: session.flow_completed,
  });
}

async function leadStillWaitingToOpenSalesFlow(
  admin: SupabaseClient,
  businessId: number,
  phone: string
): Promise<boolean> {
  const variants = contactPhoneLookupVariants(phone);
  const lookup = variants.length ? variants : [phone];
  const { data, error } = await admin
    .from("contacts")
    .select("sales_flow_started_at, trial_registered")
    .eq("business_id", businessId)
    .in("phone", lookup)
    .limit(1);
  if (error) {
    if (/sales_flow_started_at|column/i.test(error.message)) return true;
    console.warn("[business-conversation-flow] new-lead lookup failed:", error.message);
    return false;
  }
  const row = (data ?? [])[0] as { sales_flow_started_at?: string | null; trial_registered?: boolean | null } | undefined;
  if (!row) return true;
  if (row.trial_registered === true) return false;
  return !String(row.sales_flow_started_at ?? "").trim();
}

export async function handleBusinessConversationFlowInbound(input: {
  businessId: number;
  businessSlug: string;
  phone: string;
  text: string;
  phoneNumberId: string;
  sessionId: string;
}): Promise<{ handled: boolean }> {
  const businessId = Number(input.businessId);
  const phone = phoneKey(input.phone);
  if (!businessId || !phone) return { handled: false };

  const admin = createSupabaseAdminClient();
  const graph = await loadGraph(admin, businessId);
  if (!graph) return { handled: false };

  const text = String(input.text ?? "").trim();
  let session = await loadSession(admin, businessId, phone);

  if (session?.flow_completed) {
    if (!text) return { handled: true };
    const answer = await answerFreeQuestion(input.businessSlug, input.sessionId, text);
    await sendText(input.phoneNumberId, input.phone, input.businessSlug, input.sessionId, answer);
    return { handled: true };
  }

  const waitingNode = session?.current_node_id
    ? graph.nodes.find((node) => node.id === session?.current_node_id)
    : null;
  const alreadyInsideFlow =
    waitingNode?.type === "question" || waitingNode?.type === "daytime" || waitingNode?.type === "register";
  const openFromAnyMessage =
    businessOpensSalesFlowOnAnyNewLeadMessage(input.businessSlug) &&
    !alreadyInsideFlow &&
    (await leadStillWaitingToOpenSalesFlow(admin, businessId, input.phone));

  if (openFromAnyMessage || !session?.current_node_id) {
    const start = startNode(graph.nodes, graph.edges);
    if (!start) return { handled: false };
    session = {
      id: session?.id ?? "",
      current_node_id: start.id,
      flow_completed: false,
      product_slug: "",
      captured_day: "",
      captured_time: "",
    };
    await markContactSalesFlowStarted({
      supabase: admin,
      businessId,
      businessSlug: input.businessSlug,
      phone: input.phone,
    });
    await deliverFrom({
      admin,
      businessId,
      businessSlug: input.businessSlug,
      phone: input.phone,
      phoneNumberId: input.phoneNumberId,
      sessionId: input.sessionId,
      nodes: graph.nodes,
      edges: graph.edges,
      session,
      nodeId: start.id,
    });
    return { handled: true };
  }

  const current = graph.nodes.find((n) => n.id === session?.current_node_id);
  if (current?.type === "daytime") {
    const slots = await weeklySlotsForProduct(admin, businessId, session.product_slug);
    const index = matchQuestionButton(
      slots.map((slot) => slot.label),
      text
    );
    const chosen = index >= 0 ? slots[index] : null;
    if (!chosen) {
      await deliverFrom({
        admin,
        businessId,
        businessSlug: input.businessSlug,
        phone: input.phone,
        phoneNumberId: input.phoneNumberId,
        sessionId: input.sessionId,
        nodes: graph.nodes,
        edges: graph.edges,
        session,
        nodeId: current.id,
      });
      return { handled: true };
    }
    session = { ...session, captured_day: chosen.day, captured_time: chosen.time };
    await deliverFrom({
      admin,
      businessId,
      businessSlug: input.businessSlug,
      phone: input.phone,
      phoneNumberId: input.phoneNumberId,
      sessionId: input.sessionId,
      nodes: graph.nodes,
      edges: graph.edges,
      session,
      nodeId: current.id,
    });
    return { handled: true };
  }

  if (!current || current.type !== "question") {
    const start = startNode(graph.nodes, graph.edges);
    if (!start) return { handled: false };
    await deliverFrom({
      admin,
      businessId,
      businessSlug: input.businessSlug,
      phone: input.phone,
      phoneNumberId: input.phoneNumberId,
      sessionId: input.sessionId,
      nodes: graph.nodes,
      edges: graph.edges,
      session: session ?? {
        id: "",
        current_node_id: start.id,
        flow_completed: false,
        product_slug: "",
        captured_day: "",
        captured_time: "",
      },
      nodeId: start.id,
    });
    return { handled: true };
  }

  const buttons = questionButtons(current);
  const index = matchQuestionButton(buttons, text);
  if (index < 0) {
    await deliverFrom({
      admin,
      businessId,
      businessSlug: input.businessSlug,
      phone: input.phone,
      phoneNumberId: input.phoneNumberId,
      sessionId: input.sessionId,
      nodes: graph.nodes,
      edges: graph.edges,
      session,
      nodeId: current.id,
    });
    return { handled: true };
  }

  const next = edgeFrom(graph.edges, current.id, `btn-${index}`) ?? edgeFrom(graph.edges, current.id, "out");
  if (!next) {
    await saveSession(admin, businessId, phone, session);
    return { handled: true };
  }
  await deliverFrom({
    admin,
    businessId,
    businessSlug: input.businessSlug,
    phone: input.phone,
    phoneNumberId: input.phoneNumberId,
    sessionId: input.sessionId,
    nodes: graph.nodes,
    edges: graph.edges,
    session,
    nodeId: next.target_node_id,
  });
  return { handled: true };
}
