import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildHaikuRequest, readHaikuText } from "@/lib/ai-models";
import { buildFreeQuestionBehaviorBlock } from "@/lib/wa-personal-inbound";
import { isAnthropicCreditExhausted } from "@/lib/claude";
import { resolveClaudeApiKey } from "@/lib/server-env";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import { HEYZOE_SF_SERVICE_PREFIX, logMessage } from "@/lib/analytics";
import { buildMetaInteractivePayload, sendMetaWhatsAppMessage, sendWhatsAppMediaMessage } from "@/lib/whatsapp";
import { WHATSAPP_MEDIA_CAPTION_MAX_CHARS } from "@/lib/whatsapp-media-limits";
import { stripModelThoughtLeak } from "@/lib/wa-model-thought-strip";
import { markContactTrialRegisteredManually } from "@/lib/trial-registered-manual";
import {
  fillRegistrationText,
  inboundRestartsBusinessFlowFromStart,
  matchQuestionButton,
} from "@/lib/business-conversation-flow-text";
import {
  businessOpensSalesFlowOnAnyNewLeadMessage,
  memberSalesFlowStartGate,
} from "@/lib/sales-flow-start-triggers";
import { markContactSalesFlowStarted } from "@/lib/contacts-sales-flow-started";
import { buildWaSessionId, contactPhoneLookupVariants, waSessionIdLookupVariants } from "@/lib/phone-normalize";
import { clampWaReplyButtonTitle } from "@/lib/wa-button-label";
import {
  serviceMetaFromDescription,
  weeklyScheduleSlotButtons,
  type WeeklyScheduleButton,
} from "@/lib/product-schedule-slots";

export type BusinessFlowNodeType = "message" | "question" | "product" | "daytime" | "register" | "followup" | "details";

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
  pending_followup_node_id: string | null;
  followup_due_at: string | null;
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
  const marked = nodes.find((node) => node.data.is_start === true);
  if (marked) return marked;
  const targeted = new Set(edges.map((e) => e.target_node_id));
  const roots = nodes.filter((n) => !targeted.has(n.id));
  const continues = roots.filter((node) =>
    edges.some((edge) => edge.source_node_id === node.id && edge.source_handle !== "silence")
  );
  const withText = continues.filter((node) => String(node.data.text ?? "").trim());
  return withText[0] ?? continues[0] ?? roots.find((node) => String(node.data.text ?? "").trim()) ?? roots[0] ?? nodes[0] ?? null;
}

function edgeFrom(edges: FlowEdge[], sourceId: string, handle: string): FlowEdge | null {
  return edges.find((e) => e.source_node_id === sourceId && e.source_handle === handle) ?? null;
}

function followupDelayMinutes(data: Record<string, unknown>): number {
  const n = Number(data.delay_minutes);
  if (!Number.isFinite(n)) return 120;
  return Math.min(7 * 24 * 60, Math.max(5, Math.round(n)));
}

function silenceChain(nodes: FlowNode[], edges: FlowEdge[], anchorId: string): FlowNode[] {
  const out: FlowNode[] = [];
  const seen = new Set<string>();
  let id = anchorId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const edge = edgeFrom(edges, id, "silence");
    if (!edge) break;
    const node = nodes.find((item) => item.id === edge.target_node_id && item.type === "followup");
    if (!node) break;
    out.push(node);
    id = node.id;
  }
  return out;
}

function armSilence(session: FlowSession, nodes: FlowNode[], edges: FlowEdge[], anchorId: string | null): FlowSession {
  if (!anchorId || session.flow_completed) {
    return { ...session, pending_followup_node_id: null, followup_due_at: null };
  }
  const next = silenceChain(nodes, edges, anchorId)[0];
  if (!next) return { ...session, pending_followup_node_id: null, followup_due_at: null };
  return {
    ...session,
    pending_followup_node_id: next.id,
    followup_due_at: new Date(Date.now() + followupDelayMinutes(next.data) * 60_000).toISOString(),
  };
}

function blankSession(id = ""): FlowSession {
  return {
    id,
    current_node_id: null,
    flow_completed: false,
    product_slug: "",
    captured_day: "",
    captured_time: "",
    pending_followup_node_id: null,
    followup_due_at: null,
  };
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

function messageMedia(data: Record<string, unknown>): { url: string; kind: "image" | "video" } | null {
  const url = String(data.media_url ?? "").trim();
  if (!url.startsWith("https://")) return null;
  if (data.media_kind === "video") return { url, kind: "video" };
  if (data.media_kind === "image") return { url, kind: "image" };
  return null;
}

async function sendMessageNode(
  phoneNumberId: string,
  phone: string,
  businessSlug: string,
  sessionId: string,
  node: FlowNode
) {
  const text = nodeText(node);
  const media = messageMedia(node.data);
  if (!media) {
    if (text) await sendText(phoneNumberId, phone, businessSlug, sessionId, text);
    return;
  }
  const caption = text.length <= WHATSAPP_MEDIA_CAPTION_MAX_CHARS ? text : "";
  try {
    await sendWhatsAppMediaMessage(phoneNumberId, phone, media.url, "", "", caption || undefined, media.kind);
    await logMessage({
      business_slug: businessSlug,
      role: "assistant",
      content: caption ? `[${media.kind}] ${caption}` : `[${media.kind}]`,
      model_used: "business_conversation_flow",
      session_id: sessionId,
    });
  } catch (error) {
    console.error("[business-conversation-flow] media send failed:", error);
    if (text) await sendText(phoneNumberId, phone, businessSlug, sessionId, text);
    return;
  }
  if (text.length > WHATSAPP_MEDIA_CAPTION_MAX_CHARS) {
    await sendText(phoneNumberId, phone, businessSlug, sessionId, text);
  }
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
    .filter((n) => n.id && (n.type === "message" || n.type === "question" || n.type === "product" || n.type === "daytime" || n.type === "register" || n.type === "followup" || n.type === "details"));
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

function sessionFromRow(data: Record<string, unknown>): FlowSession {
  return {
    id: String(data.id ?? ""),
    current_node_id: (data.current_node_id as string | null) ?? null,
    flow_completed: data.flow_completed === true,
    product_slug: String(data.product_slug ?? ""),
    captured_day: String(data.captured_day ?? ""),
    captured_time: String(data.captured_time ?? ""),
    pending_followup_node_id: (data.pending_followup_node_id as string | null) ?? null,
    followup_due_at: data.followup_due_at ? String(data.followup_due_at) : null,
  };
}

async function loadSession(admin: SupabaseClient, businessId: number, phone: string): Promise<FlowSession | null> {
  const select =
    "id, current_node_id, flow_completed, product_slug, captured_day, captured_time, pending_followup_node_id, followup_due_at";
  const first = await admin
    .from("business_conversation_sessions")
    .select(select)
    .eq("business_id", businessId)
    .eq("phone", phone)
    .maybeSingle();
  const missingColumn = first.error && /pending_followup_node_id|followup_due_at|column/i.test(first.error.message);
  const result = missingColumn
    ? await admin
        .from("business_conversation_sessions")
        .select("id, current_node_id, flow_completed, product_slug, captured_day, captured_time")
        .eq("business_id", businessId)
        .eq("phone", phone)
        .maybeSingle()
    : first;
  if (result.error || !result.data) return null;
  return sessionFromRow(result.data as Record<string, unknown>);
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
  const withFollowup = {
    ...row,
    pending_followup_node_id: patch.pending_followup_node_id ?? null,
    followup_due_at: patch.followup_due_at ?? null,
  };
  const first = await admin.from("business_conversation_sessions").upsert(withFollowup, { onConflict: "business_id,phone" });
  const missingColumn = first.error && /pending_followup_node_id|followup_due_at|column/i.test(first.error.message);
  const error = missingColumn
    ? (await admin.from("business_conversation_sessions").upsert(row, { onConflict: "business_id,phone" })).error
    : first.error;
  if (error) console.error("[business-conversation-flow] session save failed:", error.message);
}

const SLOT_PICK_PROMPT = "באיזה מועד נוח לך?";
const DETAILS_ACK = "קיבלנו את הפרטים, תודה!";
const DETAILS_PROMPT = "ספרו לי בקצרה מה חשוב שנדע.";

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
    const params = buildHaikuRequest("conversation-flow-free-question");
    const behavior = buildFreeQuestionBehaviorBlock({
      hasArboxConnection: pack?.hasArboxConnection === true,
      canShowSchedule: Boolean(pack?.schedulePublicUrl || pack?.scheduleScanImageUrl || pack?.arboxLink),
      canSendMembershipLink: Boolean(pack?.membershipsUrl?.trim()),
      canScheduleCall: pack?.salesFlowCallSchedulingEnabled === true,
      canSendTrialLink: Boolean(pack?.ctaLink?.trim() || pack?.salesFlowConfig),
    });
    const resp = await client.messages.create({
      ...params,
      messages: [
        {
          role: "user",
          content: `את זואי, עוזרת של העסק. ${behavior} רק מתוך הידע. בלי קישור תשלום ובלי לבקש כרטיס אשראי.
ידע:
${knowledge || "אין ידע נוסף."}

שאלה: ${question}`,
        },
      ],
    });
    const read = readHaikuText("conversation-flow-free-question", resp);
    const text = read.truncated ? "" : read.text;
    const fallback = "אני כאן, אפשר לשאול אותי עוד.";
    const stripped = stripModelThoughtLeak(text || fallback, {
      businessSlug,
      conversationId: sessionId,
    });
    return stripped.trim() || fallback;
  } catch (e) {
    if (isAnthropicCreditExhausted(e)) {
      console.error("[business-conversation-flow] Anthropic credit exhausted; not replying");
      return "";
    }
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
  let silenceAnchor: string | null = null;

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
      session = armSilence(
        { ...session, current_node_id: node.id, flow_completed: false },
        input.nodes,
        input.edges,
        node.id
      );
      await saveSession(input.admin, input.businessId, phoneKey(input.phone), session);
      return;
    }

    if (node.type === "details") {
      await sendText(
        input.phoneNumberId,
        input.phone,
        input.businessSlug,
        input.sessionId,
        nodeText(node) || DETAILS_PROMPT
      );
      session = armSilence(
        { ...session, current_node_id: node.id, flow_completed: false },
        input.nodes,
        input.edges,
        node.id
      );
      await saveSession(input.admin, input.businessId, phoneKey(input.phone), session);
      return;
    }

    if (node.type === "followup") break;

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
      session = armSilence(
        { ...session, current_node_id: node.id, flow_completed: false },
        input.nodes,
        input.edges,
        node.id
      );
      await saveSession(input.admin, input.businessId, phoneKey(input.phone), session);
      return;
    }

    if (node.type === "product") {
      silenceAnchor = node.id;
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
      session = armSilence(
        { ...session, current_node_id: node.id, flow_completed: true },
        input.nodes,
        input.edges,
        null
      );
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

    silenceAnchor = node.id;
    if (node.type === "message") {
      await sendMessageNode(input.phoneNumberId, input.phone, input.businessSlug, input.sessionId, node);
    } else {
      const text = nodeText(node);
      if (text) await sendText(input.phoneNumberId, input.phone, input.businessSlug, input.sessionId, text);
    }
    const next = edgeFrom(input.edges, node.id, "out");
    nodeId = next?.target_node_id ?? null;
  }

  const endedOnFollowup = Boolean(nodeId && byId.get(nodeId)?.type === "followup");
  const stayId = endedOnFollowup || !nodeId ? silenceAnchor : nodeId;
  session = armSilence(
    { ...session, current_node_id: stayId, flow_completed: session.flow_completed },
    input.nodes,
    input.edges,
    stayId
  );
  await saveSession(input.admin, input.businessId, phoneKey(input.phone), session);
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
  /** Already loaded on the contact row. Known members do not start or reset this flow. */
  arboxIsMember?: boolean | null;
}): Promise<{ handled: boolean }> {
  const businessId = Number(input.businessId);
  const phone = phoneKey(input.phone);
  if (!businessId || !phone) return { handled: false };

  const admin = createSupabaseAdminClient();
  const graph = await loadGraph(admin, businessId);
  if (!graph) return { handled: false };

  const text = String(input.text ?? "").trim();
  let session = await loadSession(admin, businessId, phone);

  const waitingNode = session?.current_node_id
    ? graph.nodes.find((node) => node.id === session?.current_node_id)
    : null;
  const salesFlowInProgress =
    Boolean(session?.current_node_id) && session?.flow_completed !== true;
  const memberGate = memberSalesFlowStartGate({
    arboxIsMember: input.arboxIsMember,
    salesFlowInProgress,
  });
  const restartFromStart =
    memberGate === "allow" &&
    Boolean(text) &&
    inboundRestartsBusinessFlowFromStart({
      text,
      businessSlug: input.businessSlug,
      currentQuestionButtons: waitingNode?.type === "question" ? questionButtons(waitingNode) : [],
    });

  if (session?.flow_completed && !restartFromStart) {
    if (!text) return { handled: true };
    const answer = await answerFreeQuestion(input.businessSlug, input.sessionId, text);
    await sendText(input.phoneNumberId, input.phone, input.businessSlug, input.sessionId, answer);
    return { handled: true };
  }

  const alreadyInsideFlow =
    !restartFromStart &&
    (waitingNode?.type === "question" ||
      waitingNode?.type === "daytime" ||
      waitingNode?.type === "register" ||
      waitingNode?.type === "details");
  const openFromAnyMessage =
    memberGate === "allow" &&
    !restartFromStart &&
    businessOpensSalesFlowOnAnyNewLeadMessage(input.businessSlug) &&
    !alreadyInsideFlow &&
    (await leadStillWaitingToOpenSalesFlow(admin, businessId, input.phone));

  if (
    memberGate === "allow" &&
    (restartFromStart || openFromAnyMessage || !session?.current_node_id)
  ) {
    if (restartFromStart) {
      console.info("[business-conversation-flow] start trigger reopens flow from first node", {
        businessSlug: input.businessSlug,
        phone,
        flowCompleted: session?.flow_completed === true,
        previousNodeType: waitingNode?.type ?? null,
      });
    }
    const start = startNode(graph.nodes, graph.edges);
    if (!start) return { handled: false };
    session = {
      ...blankSession(session?.id ?? ""),
      current_node_id: start.id,
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

  if (!session || !session.current_node_id) return { handled: false };
  const openSession = session;

  const current = graph.nodes.find((n) => n.id === openSession.current_node_id);
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

  if (current?.type === "details") {
    if (!text) {
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
    await sendText(input.phoneNumberId, input.phone, input.businessSlug, input.sessionId, DETAILS_ACK);
    const next = edgeFrom(graph.edges, current.id, "out");
    if (!next) {
      await saveSession(admin, businessId, phone, armSilence({ ...session, current_node_id: current.id }, graph.nodes, graph.edges, null));
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

  if (!current || current.type !== "question") {
    if (memberGate !== "allow") return { handled: false };
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
      session: session ?? { ...blankSession(), current_node_id: start.id },
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
    await saveSession(admin, businessId, phone, armSilence(session, graph.nodes, graph.edges, null));
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

/**
 * פולואפים של מסלול השיחה. רץ מתוך /api/cron/wa-followups (cron-job.org, בערך כל 5 דקות).
 * שאילתה אחת על אינדקס followup_due_at, עד 40 שורות שכבר הגיע זמנן. לא סריקת טבלה.
 * לכל שורה: ערוץ, איש קשר, והודעת משתמש אחרונה — ואז לכל היותר הודעת וואטסאפ אחת.
 */
export async function runDueConversationFollowups(admin: SupabaseClient): Promise<{
  sent: number;
  cleared: number;
  skipped: number;
}> {
  const { isAllowedWhatsAppSendTimeIsrael, WA_FOLLOWUP_QUIET_END_MINUTES } = await import("@/lib/israel-time");
  if (!isAllowedWhatsAppSendTimeIsrael(new Date(), WA_FOLLOWUP_QUIET_END_MINUTES)) {
    return { sent: 0, cleared: 0, skipped: 0 };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("business_conversation_sessions")
    .select(
      "id, business_id, phone, current_node_id, flow_completed, product_slug, captured_day, captured_time, pending_followup_node_id, followup_due_at"
    )
    .eq("flow_completed", false)
    .not("pending_followup_node_id", "is", null)
    .lte("followup_due_at", nowIso)
    .order("followup_due_at", { ascending: true })
    .limit(40);
  if (error) {
    if (/pending_followup_node_id|followup_due_at|column/i.test(error.message)) {
      console.error(
        "[business-conversation-flow] followups need supabase/business_conversation_flow_followup.sql:",
        error.message
      );
    } else {
      console.error("[business-conversation-flow] followup due query failed:", error.message);
    }
    return { sent: 0, cleared: 0, skipped: 0 };
  }

  let sent = 0;
  let cleared = 0;
  let skipped = 0;
  const channelCache = new Map<number, { slug: string; phoneNumberId: string; active: boolean }>();

  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const session = sessionFromRow(row);
    const businessId = Number(row.business_id);
    const phone = phoneKey(String(row.phone ?? ""));
    if (!businessId || !phone || !session.pending_followup_node_id || !session.current_node_id) {
      skipped += 1;
      continue;
    }

    let channel = channelCache.get(businessId);
    if (!channel) {
      const biz = await admin.from("businesses").select("slug, is_active").eq("id", businessId).maybeSingle();
      const bizRow = biz.data as { slug?: unknown; is_active?: boolean | null } | null;
      const slug = String(bizRow?.slug ?? "").trim().toLowerCase();
      const wa = await admin
        .from("whatsapp_channels")
        .select("phone_number_id")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      channel = {
        slug,
        phoneNumberId: String((wa.data as { phone_number_id?: unknown } | null)?.phone_number_id ?? "").trim(),
        active: bizRow?.is_active !== false && Boolean(slug),
      };
      channelCache.set(businessId, channel);
    }
    if (!channel.active || !channel.phoneNumberId || !channel.slug) {
      skipped += 1;
      continue;
    }

    const graph = await loadGraph(admin, businessId);
    const chain = graph ? silenceChain(graph.nodes, graph.edges, session.current_node_id) : [];
    const followup = chain.find((node) => node.id === session.pending_followup_node_id) ?? null;
    if (!graph || !followup) {
      await saveSession(admin, businessId, phone, { ...session, pending_followup_node_id: null, followup_due_at: null });
      cleared += 1;
      continue;
    }

    const variants = contactPhoneLookupVariants(phone);
    const phoneLookup = variants.length ? variants : [phone];
    const contactFull = await admin
      .from("contacts")
      .select("opted_out, marketing_opted_out, trial_registered")
      .eq("business_id", businessId)
      .in("phone", phoneLookup)
      .limit(1);
    const contact = contactFull.error && /marketing_opted_out/i.test(contactFull.error.message)
      ? await admin
          .from("contacts")
          .select("opted_out, trial_registered")
          .eq("business_id", businessId)
          .in("phone", phoneLookup)
          .limit(1)
      : contactFull;
    if (contactFull.error && /marketing_opted_out/i.test(contactFull.error.message)) {
      console.error(
        "[business-conversation-flow] contacts.marketing_opted_out missing — run supabase/contacts_marketing_opted_out.sql"
      );
    }
    const contactRow = (contact.data ?? [])[0] as {
      opted_out?: boolean | null;
      marketing_opted_out?: boolean | null;
      trial_registered?: boolean | null;
    } | undefined;
    if (contactRow?.opted_out || contactRow?.marketing_opted_out || contactRow?.trial_registered) {
      await saveSession(admin, businessId, phone, { ...session, pending_followup_node_id: null, followup_due_at: null });
      cleared += 1;
      continue;
    }

    const { isWaFollowupBlockedByAppPause } = await import("@/lib/wa-app-echo-pause");
    if (
      await isWaFollowupBlockedByAppPause({
        admin,
        businessSlug: channel.slug,
        phoneNumberId: channel.phoneNumberId,
        phone,
      })
    ) {
      skipped += 1;
      continue;
    }

    const armedAt = new Date(
      new Date(session.followup_due_at ?? nowIso).getTime() - followupDelayMinutes(followup.data) * 60_000
    ).toISOString();
    const sessionIds = waSessionIdLookupVariants(channel.phoneNumberId, phone);
    const reply = await admin
      .from("messages")
      .select("id")
      .eq("business_slug", channel.slug)
      .in("session_id", sessionIds.length ? sessionIds : [buildWaSessionId(channel.phoneNumberId, phone)])
      .eq("role", "user")
      .gt("created_at", armedAt)
      .limit(1);
    if ((reply.data ?? []).length) {
      await saveSession(admin, businessId, phone, { ...session, pending_followup_node_id: null, followup_due_at: null });
      cleared += 1;
      continue;
    }

    const text = String(followup.data.text ?? "").trim();
    const idx = chain.findIndex((node) => node.id === followup.id);
    const next = chain[idx + 1];
    if (!text) {
      await saveSession(admin, businessId, phone, {
        ...session,
        pending_followup_node_id: next?.id ?? null,
        followup_due_at: next ? new Date(Date.now() + followupDelayMinutes(next.data) * 60_000).toISOString() : null,
      });
      cleared += 1;
      continue;
    }

    try {
      const sessionId = buildWaSessionId(channel.phoneNumberId, phone);
      await sendText(channel.phoneNumberId, phone, channel.slug, sessionId, text);
    } catch (e) {
      console.error("[business-conversation-flow] followup send failed:", e);
      skipped += 1;
      continue;
    }

    await saveSession(admin, businessId, phone, {
      ...session,
      pending_followup_node_id: next?.id ?? null,
      followup_due_at: next ? new Date(Date.now() + followupDelayMinutes(next.data) * 60_000).toISOString() : null,
    });
    sent += 1;
  }

  return { sent, cleared, skipped };
}
