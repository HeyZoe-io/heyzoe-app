import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  sendWhatsAppMessage,
  sendWhatsAppTextOrMenu,
  sendWhatsAppMediaMessage,
  resolveMetaInteractiveLabel,
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
} from "@/lib/whatsapp";

export type MarketingFlowNodeRow = {
  id: number;
  type: string;
  data: Record<string, unknown> | null;
  position_x: number;
  position_y: number;
  /** נוד התחלה — session חדש מתחיל כאן */
  is_start?: boolean;
};

export type MarketingFlowEdgeRow = {
  id: number;
  source_node_id: number;
  target_node_id: number;
  label: string;
};

export type MarketingFlowSettingsRow = {
  id: number;
  is_active: boolean;
  root_node_id: number | null;
};

export type MarketingChannelRow = {
  id: number;
  phone_number_id: string;
  phone_display: string;
  is_active: boolean;
};

export async function loadMarketingFlowBundle(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const [{ data: channel }, { data: settings }, { data: nodes }, { data: edges }] = await Promise.all([
    admin.from("marketing_whatsapp_channel").select("*").eq("id", 1).maybeSingle(),
    admin.from("marketing_flow_settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("marketing_flow_nodes").select("*").order("id", { ascending: true }),
    admin.from("marketing_flow_edges").select("*"),
  ]);
  return {
    channel: (channel ?? null) as MarketingChannelRow | null,
    settings: (settings ?? null) as MarketingFlowSettingsRow | null,
    nodes: (nodes ?? []) as MarketingFlowNodeRow[],
    edges: (edges ?? []) as MarketingFlowEdgeRow[],
  };
}

export function inferRootNodeId(
  nodes: MarketingFlowNodeRow[],
  edges: MarketingFlowEdgeRow[],
  explicit: number | null | undefined
): number | null {
  if (explicit != null && Number.isFinite(Number(explicit))) return Number(explicit);
  const targets = new Set(edges.map((e) => e.target_node_id));
  const roots = nodes.filter((n) => !targets.has(n.id));
  if (!roots.length) return nodes[0]?.id ?? null;
  return [...roots].sort((a, b) => a.id - b.id)[0]!.id;
}

/** נוד התחלה (is_start) או root מוגדר / נוד ללא כניסה. */
export function getStartNodeId(
  nodes: MarketingFlowNodeRow[],
  edges: MarketingFlowEdgeRow[],
  settingsRoot: number | null | undefined
): number | null {
  const flagged = nodes.filter((n) => Boolean((n as MarketingFlowNodeRow).is_start));
  if (flagged.length >= 1) {
    return flagged.sort((a, b) => a.id - b.id)[0]!.id;
  }
  return inferRootNodeId(nodes, edges, settingsRoot);
}

function nodeData(n: MarketingFlowNodeRow): Record<string, unknown> {
  return (n.data && typeof n.data === "object" ? n.data : {}) as Record<string, unknown>;
}

function outgoingEdges(edges: MarketingFlowEdgeRow[], sourceId: number) {
  return edges.filter((e) => e.source_node_id === sourceId);
}

function pickEdgeForText(
  edgesOut: MarketingFlowEdgeRow[],
  userText: string,
  metaReplyId: string | undefined,
  buttonCandidates: string[]
): MarketingFlowEdgeRow | null {
  const t = userText.trim();
  if (!t) return null;
  const resolved = metaReplyId
    ? resolveMetaInteractiveLabel(metaReplyId, t, buttonCandidates)
    : t;
  const norm = (s: string) => s.trim().toLowerCase();
  const hit = edgesOut.find((e) => norm(e.label) === norm(resolved));
  return hit ?? edgesOut.find((e) => norm(e.label) === norm(t)) ?? null;
}

const MAX_AUTO_CHAIN = 12;

/**
 * Sends WhatsApp step(s) starting at `nodeId`, chaining through message/cta/media until question or followup.
 * Returns the node id we are now "waiting" on (question/followup) or last sent leaf.
 */
export async function runMarketingFlowFromNode(input: {
  fromPhoneNumberId: string;
  toE164: string;
  nodes: MarketingFlowNodeRow[];
  edges: MarketingFlowEdgeRow[];
  startNodeId: number;
  patchSession: (patch: Record<string, unknown>) => Promise<void>;
}): Promise<void> {
  const accountSid = resolveTwilioAccountSid();
  const authToken = resolveTwilioAuthToken();
  let cur = input.startNodeId;
  const visited = new Set<number>();

  for (let hop = 0; hop < MAX_AUTO_CHAIN; hop++) {
    if (visited.has(cur)) break;
    visited.add(cur);
    const node = input.nodes.find((n) => n.id === cur);
    if (!node) break;
    const d = nodeData(node);

    if (node.type === "message") {
      const text = String(d.text ?? "").trim();
      if (text) {
        await sendWhatsAppMessage(input.fromPhoneNumberId, input.toE164, text, accountSid, authToken);
      }
      const outs = outgoingEdges(input.edges, node.id);
      const next = outs[0]?.target_node_id;
      if (!next) {
        await input.patchSession({ current_node_id: node.id, followup_wake_at: null, followup_next_node_id: null });
        return;
      }
      cur = next;
      continue;
    }

    if (node.type === "cta") {
      const text = String(d.text ?? "").trim();
      const url = String(d.url ?? "").trim();
      const line = url ? `${text ? `${text}\n\n` : ""}${url}`.trim() : text;
      if (line) {
        await sendWhatsAppMessage(input.fromPhoneNumberId, input.toE164, line, accountSid, authToken);
      }
      const outs = outgoingEdges(input.edges, node.id);
      const next = outs[0]?.target_node_id;
      if (!next) {
        await input.patchSession({ current_node_id: node.id, followup_wake_at: null, followup_next_node_id: null });
        return;
      }
      cur = next;
      continue;
    }

    if (node.type === "media") {
      const url = String(d.mediaUrl ?? "").trim();
      const caption = String(d.caption ?? "").trim();
      const kind = d.mediaKind === "video" ? "video" : "image";
      if (url) {
        await sendWhatsAppMediaMessage(
          input.fromPhoneNumberId,
          input.toE164,
          url,
          accountSid,
          authToken,
          caption || undefined,
          kind
        );
      }
      const outs = outgoingEdges(input.edges, node.id);
      const next = outs[0]?.target_node_id;
      if (!next) {
        await input.patchSession({ current_node_id: node.id, followup_wake_at: null, followup_next_node_id: null });
        return;
      }
      cur = next;
      continue;
    }

    if (node.type === "question") {
      const q = String(d.text ?? "").trim();
      const outs = outgoingEdges(input.edges, node.id);
      const labels = outs.map((e) => e.label.trim()).filter(Boolean).slice(0, 3);
      if (labels.length >= 2) {
        await sendWhatsAppTextOrMenu(
          input.fromPhoneNumberId,
          input.toE164,
          q || "בחרו אפשרות:",
          labels as [string, string, ...string[]],
          accountSid,
          authToken
        );
      } else if (q) {
        await sendWhatsAppMessage(input.fromPhoneNumberId, input.toE164, q, accountSid, authToken);
      }
      await input.patchSession({ current_node_id: node.id, followup_wake_at: null, followup_next_node_id: null });
      return;
    }

    if (node.type === "followup") {
      const minutes = Math.max(1, Math.min(24 * 60, Number(d.delayMinutes ?? 20) || 20));
      const outs = outgoingEdges(input.edges, node.id);
      const next = outs[0]?.target_node_id;
      if (!next) {
        await input.patchSession({ current_node_id: node.id, followup_wake_at: null, followup_next_node_id: null });
        return;
      }
      const wake = new Date(Date.now() + minutes * 60_000).toISOString();
      await input.patchSession({
        current_node_id: node.id,
        followup_wake_at: wake,
        followup_next_node_id: next,
      });
      return;
    }

    break;
  }
}

export async function handleMarketingInboundText(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  channel: MarketingChannelRow;
  settings: MarketingFlowSettingsRow;
  nodes: MarketingFlowNodeRow[];
  edges: MarketingFlowEdgeRow[];
  fromE164: string;
  text: string;
  metaInteractiveReplyId?: string;
}): Promise<void> {
  if (!input.channel.is_active || !input.settings.is_active) return;

  const phone = input.fromE164.trim();
  const pid = input.channel.phone_number_id.trim();

  const startNodeId = getStartNodeId(input.nodes, input.edges, input.settings.root_node_id);
  if (!startNodeId) return;

  const { data: sessionRow } = await input.admin
    .from("marketing_flow_sessions")
    .select("*")
    .eq("phone_number", phone)
    .maybeSingle();

  const patchSession = async (patch: Record<string, unknown>) => {
    await input.admin.from("marketing_flow_sessions").upsert(
      {
        phone_number: phone,
        updated_at: new Date().toISOString(),
        ...patch,
      } as any,
      { onConflict: "phone_number" }
    );
  };

  const session = sessionRow as
    | {
        id?: number;
        current_node_id?: number | null;
      }
    | null;

  // 1–2: session חדש — current_node_id = נוד התחלה (is_start או root)
  if (!session) {
    await patchSession({
      current_node_id: startNodeId,
      followup_wake_at: null,
      followup_next_node_id: null,
    });
  } else {
    // תגובת משתמש מנקה פולואפ מתוזמן
    await patchSession({ followup_wake_at: null, followup_next_node_id: null });
  }

  let startId = startNodeId;
  const currentId = session?.current_node_id != null ? Number(session.current_node_id) : null;

  // 3–4: אם הנוכחי הוא question — התאמת כפתור לפי marketing_flow_edges
  if (currentId != null) {
    const curNode = input.nodes.find((n) => n.id === currentId);
    if (curNode?.type === "question") {
      const outs = outgoingEdges(input.edges, currentId);
      const candidates = outs.map((e) => e.label);
      const picked = pickEdgeForText(outs, input.text, input.metaInteractiveReplyId, candidates);
      if (picked) {
        startId = picked.target_node_id;
      } else {
        await sendWhatsAppMessage(
          pid,
          phone,
          "לא הבנתי — בחרו אחת מהאפשרויות בכפתורים למטה 🙂",
          resolveTwilioAccountSid(),
          resolveTwilioAuthToken()
        );
        return;
      }
    } else if (session) {
      // לא באמצע שאלה — מתחילים שוב מנוד ההתחלה (הודעה חדשה)
      startId = startNodeId;
    }
  }

  // 5–6: שליחת נודים הבאים דרך Meta + עדכון current ב־patchSession מתוך runMarketingFlowFromNode
  await runMarketingFlowFromNode({
    fromPhoneNumberId: pid,
    toE164: phone,
    nodes: input.nodes,
    edges: input.edges,
    startNodeId: startId,
    patchSession,
  });
}

export async function processMarketingFollowupDue(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  sessionId: number
): Promise<boolean> {
  const bundle = await loadMarketingFlowBundle(admin);
  if (!bundle.channel?.is_active || !bundle.settings?.is_active) return false;

  const { data: row } = await admin
    .from("marketing_flow_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (!row) return false;
  const wake = String((row as any).followup_wake_at ?? "").trim();
  if (!wake) return false;
  if (new Date(wake).getTime() > Date.now()) return false;
  const nextId = Number((row as any).followup_next_node_id ?? 0);
  if (!Number.isFinite(nextId) || nextId <= 0) return false;
  const phone = String((row as any).phone_number ?? "").trim();
  if (!phone) return false;

  const pid = bundle.channel.phone_number_id.trim();

  const patchSession = async (patch: Record<string, unknown>) => {
    await admin
      .from("marketing_flow_sessions")
      .update({ updated_at: new Date().toISOString(), ...patch } as any)
      .eq("id", sessionId);
  };

  await patchSession({ followup_wake_at: null, followup_next_node_id: null });

  await runMarketingFlowFromNode({
    fromPhoneNumberId: pid,
    toE164: phone,
    nodes: bundle.nodes,
    edges: bundle.edges,
    startNodeId: nextId,
    patchSession,
  });
  return true;
}
