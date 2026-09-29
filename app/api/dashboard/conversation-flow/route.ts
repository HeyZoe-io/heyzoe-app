import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { assertBusinessAccess, normDashboardSlug } from "@/lib/dashboard-business-access";
import { buildDefaultConversationOpening, taglineFromSocialLinks } from "@/lib/business-conversation-opening";
import { clampWaReplyButtonTitle } from "@/lib/wa-button-label";
import { serviceMetaFromDescription, weeklyScheduleSlotButtons } from "@/lib/product-schedule-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NODE_TYPES = new Set(["message", "question", "product", "daytime", "register", "followup", "details"]);
const MAX_NODE_BUTTONS = 10;

function capNodeData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const next = { ...(data as Record<string, unknown>) };
  for (const key of ["buttons", "day_buttons", "time_buttons"]) {
    const list = next[key];
    if (Array.isArray(list)) {
      next[key] = list.slice(0, MAX_NODE_BUTTONS).map((item) => clampWaReplyButtonTitle(String(item ?? "")));
    }
  }
  const mediaUrl = typeof next.media_url === "string" ? next.media_url.trim() : "";
  const mediaKind = next.media_kind === "video" ? "video" : next.media_kind === "image" ? "image" : "";
  if (mediaUrl.startsWith("https://") && mediaKind) {
    next.media_url = mediaUrl;
    next.media_kind = mediaKind;
  } else {
    delete next.media_url;
    delete next.media_kind;
  }
  return next;
}

async function authorizedBusiness(slugRaw: string) {
  const slug = normDashboardSlug(slugRaw);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(admin, { id: user.id, email: user.email }, slug);
  if (!access.ok) return { error: NextResponse.json({ error: access.error }, { status: access.status }) };
  return { admin, businessId: access.business.id };
}

export async function GET(req: NextRequest) {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  const auth = await authorizedBusiness(slug);
  if ("error" in auth && auth.error) return auth.error;
  const { admin, businessId } = auth as { admin: ReturnType<typeof createSupabaseAdminClient>; businessId: number };

  const [nodesRes, edgesRes, productsRes, businessRes] = await Promise.all([
    admin
      .from("business_conversation_nodes")
      .select("id, type, data, position_x, position_y")
      .eq("business_id", businessId),
    admin
      .from("business_conversation_edges")
      .select("id, source_node_id, target_node_id, source_handle")
      .eq("business_id", businessId),
    admin.from("services").select("service_slug, name, description").eq("business_id", businessId).order("id", { ascending: true }),
    admin.from("businesses").select("name, bot_name, social_links").eq("id", businessId).maybeSingle(),
  ]);

  if (nodesRes.error) {
    console.error("[conversation-flow] load failed:", nodesRes.error.message);
    return NextResponse.json({ error: nodesRes.error.message }, { status: 500 });
  }

  const loadedNodes = (nodesRes.data ?? []) as Array<{ id?: unknown; type?: unknown; data?: unknown; position_x?: unknown; position_y?: unknown }>;
  const loadedEdges = (edgesRes.data ?? []) as Array<{ source_node_id?: unknown; target_node_id?: unknown; source_handle?: unknown }>;
  let responseNodes = loadedNodes;
  if (loadedNodes.length && !loadedNodes.some((node) => (node.data as { is_start?: unknown } | null)?.is_start === true)) {
    const targeted = new Set(loadedEdges.map((edge) => String(edge.target_node_id ?? "")));
    const roots = loadedNodes.filter((node) => node.type === "message" && !targeted.has(String(node.id ?? "")));
    const continues = roots.filter((node) =>
      loadedEdges.some(
        (edge) => String(edge.source_node_id ?? "") === String(node.id ?? "") && String(edge.source_handle ?? "out") !== "silence"
      )
    );
    const withText = continues.filter((node) => String((node.data as { text?: unknown } | null)?.text ?? "").trim());
    const pool = withText.length ? withText : continues.length ? continues : roots;
    const start = [...pool].sort((a, b) => (Number(b.position_x) || 0) - (Number(a.position_x) || 0))[0];
    if (start?.id) {
      const data = { ...((start.data as Record<string, unknown> | null) ?? {}), is_start: true };
      const { error } = await admin
        .from("business_conversation_nodes")
        .update({ data })
        .eq("id", String(start.id))
        .eq("business_id", businessId);
      if (error) console.error("[conversation-flow] lock start node failed:", error.message);
      else responseNodes = loadedNodes.map((node) => (String(node.id) === String(start.id) ? { ...node, data } : node));
    }
  }

  const business = businessRes.data as { name?: unknown; bot_name?: unknown; social_links?: unknown } | null;
  const { tagline, address } = taglineFromSocialLinks(business?.social_links);
  const openingText = buildDefaultConversationOpening({
    botName: String(business?.bot_name ?? ""),
    businessName: String(business?.name ?? ""),
    tagline,
    address,
  });

  return NextResponse.json({
    nodes: responseNodes,
    edges: edgesRes.data ?? [],
    openingText,
    products: (productsRes.data ?? []).map((row) => {
      const record = row as { service_slug?: unknown; name?: unknown; description?: unknown };
      return {
        slug: String(record.service_slug ?? ""),
        name: String(record.name ?? ""),
        slots: weeklyScheduleSlotButtons(serviceMetaFromDescription(record.description)).map((slot) => slot.label),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    slug?: string;
    nodes?: Array<{ id?: string; type?: string; data?: unknown; position_x?: number; position_y?: number }>;
    edges?: Array<{ source_node_id?: string; target_node_id?: string; source_handle?: string }>;
  } | null;
  const auth = await authorizedBusiness(String(body?.slug ?? ""));
  if ("error" in auth && auth.error) return auth.error;
  const { admin, businessId } = auth as { admin: ReturnType<typeof createSupabaseAdminClient>; businessId: number };

  const existingRes = await admin
    .from("business_conversation_nodes")
    .select("id, type, data, position_x, position_y")
    .eq("business_id", businessId);
  if (existingRes.error) {
    console.error("[conversation-flow] load nodes before save failed:", existingRes.error.message);
    return NextResponse.json({ error: existingRes.error.message }, { status: 500 });
  }
  const existing = (existingRes.data ?? []) as Array<{
    id?: unknown;
    type?: unknown;
    data?: unknown;
    position_x?: unknown;
    position_y?: unknown;
  }>;
  const locked = existing.find((row) => {
    const data = row.data;
    return Boolean(data && typeof data === "object" && (data as { is_start?: unknown }).is_start === true);
  });

  let nodes = (body?.nodes ?? []).filter((n) => n.id && NODE_TYPES.has(String(n.type ?? "")));
  const lockedId = locked ? String(locked.id ?? "") : "";
  if (lockedId && !nodes.some((node) => String(node.id) === lockedId)) {
    nodes = [
      ...nodes,
      {
        id: lockedId,
        type: "message",
        data: locked?.data,
        position_x: Number(locked?.position_x) || 0,
        position_y: Number(locked?.position_y) || 0,
      },
    ];
  }
  const startId =
    lockedId ||
    String(nodes.find((node) => (node.data as { is_start?: unknown } | undefined)?.is_start === true)?.id ?? "") ||
    String(nodes.find((node) => node.type === "message")?.id ?? "");
  nodes = nodes.map((node) => {
    const data = capNodeData(node.data);
    if (String(node.id) === startId) data.is_start = true;
    else delete data.is_start;
    return {
      ...node,
      type: String(node.id) === startId ? "message" : String(node.type),
      data,
    };
  });
  const nodeIds = new Set(nodes.map((n) => String(n.id)));
  const edges = (body?.edges ?? []).filter(
    (e) =>
      nodeIds.has(String(e.source_node_id ?? "")) &&
      nodeIds.has(String(e.target_node_id ?? "")) &&
      String(e.target_node_id ?? "") !== startId
  );

  if (nodes.length) {
    const { error } = await admin.from("business_conversation_nodes").upsert(
      nodes.map((n) => ({
        id: String(n.id),
        business_id: businessId,
        type: String(n.type),
        data: capNodeData(n.data),
        position_x: Number(n.position_x) || 0,
        position_y: Number(n.position_y) || 0,
      })),
      { onConflict: "id" }
    );
    if (error) {
      console.error("[conversation-flow] save nodes failed:", error.message);
      const message = /type_check|check constraint/i.test(error.message)
        ? "כדי לשמור תיבת פולואפ, איסוף פרטים או יום ושעה צריך להריץ ב-Supabase את supabase/business_conversation_flow_followup.sql"
        : error.message;
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const { error: delEdges } = await admin.from("business_conversation_edges").delete().eq("business_id", businessId);
  if (delEdges) return NextResponse.json({ error: delEdges.message }, { status: 500 });

  const keepIds = nodes.map((n) => String(n.id));
  const nodeDelete = admin.from("business_conversation_nodes").delete().eq("business_id", businessId);
  const { error: delNodes } = keepIds.length
    ? await nodeDelete.not("id", "in", `(${keepIds.join(",")})`)
    : await nodeDelete;
  if (delNodes) return NextResponse.json({ error: delNodes.message }, { status: 500 });

  if (edges.length) {
    const { error } = await admin.from("business_conversation_edges").insert(
      edges.map((e) => ({
        business_id: businessId,
        source_node_id: String(e.source_node_id),
        target_node_id: String(e.target_node_id),
        source_handle: String(e.source_handle ?? "out") || "out",
      }))
    );
    if (error) {
      console.error("[conversation-flow] insert edges failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
