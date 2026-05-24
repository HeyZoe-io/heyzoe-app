import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { invalidateMarketingFlowCache } from "@/lib/marketing-flow-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NODE_TYPES = new Set(["message", "question", "media", "cta", "followup", "delay"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

function parseEdgeDbId(clientEdgeId: string): string | null {
  const s = String(clientEdgeId ?? "").trim();
  if (!s) return null;
  if (s.startsWith("e_")) {
    const rest = s.slice(2);
    if (isUuid(rest)) return rest;
    return null;
  }
  return isUuid(s) ? s : null;
}

function nodeRowFromPayload(n: unknown): {
  clientId: string;
  type: string;
  data: unknown;
  position_x: number;
  position_y: number;
} | null {
  const o = n as Record<string, unknown>;
  const clientId = String(o.id ?? "").trim();
  if (!clientId) return null;
  const type = String(o.type ?? "message");
  const safeType = NODE_TYPES.has(type) ? type : "message";
  const pos = (o.position && typeof o.position === "object" ? (o.position as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const data = o.data && typeof o.data === "object" ? o.data : {};
  return {
    clientId,
    type: safeType,
    data,
    position_x: Number(pos.x ?? 0),
    position_y: Number(pos.y ?? 0),
  };
}

/** Update existing nodes/edges in place, insert new ones, delete removed — preserves node UUIDs for active sessions. */
async function persistMarketingFlowGraph(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  rawNodes: unknown[],
  rawEdges: unknown[]
): Promise<{ nodeCount: number; edgeCount: number }> {
  const { data: existingNodeRows, error: loadNE } = await admin.from("marketing_flow_nodes").select("id");
  if (loadNE) throw new Error(`load_nodes: ${loadNE.message}`);
  const existingNodeIds = new Set((existingNodeRows ?? []).map((r) => String((r as { id: string }).id)));

  const { data: existingEdgeRows, error: loadEE } = await admin.from("marketing_flow_edges").select("id");
  if (loadEE) throw new Error(`load_edges: ${loadEE.message}`);
  const existingEdgeIds = new Set((existingEdgeRows ?? []).map((r) => String((r as { id: string }).id)));

  if (rawNodes.length === 0) {
    if (existingEdgeIds.size > 0) {
      const { error } = await admin.from("marketing_flow_edges").delete().not("id", "is", null);
      if (error) throw new Error(`delete_edges: ${error.message}`);
    }
    if (existingNodeIds.size > 0) {
      const { error } = await admin.from("marketing_flow_nodes").delete().not("id", "is", null);
      if (error) throw new Error(`delete_nodes: ${error.message}`);
    }
    return { nodeCount: 0, edgeCount: 0 };
  }

  const clientToDb = new Map<string, string>();
  const keptNodeDbIds = new Set<string>();

  for (const n of rawNodes) {
    const parsed = nodeRowFromPayload(n);
    if (!parsed) continue;
    const { clientId, type, data, position_x, position_y } = parsed;
    const row = { type, data, position_x, position_y };

    if (isUuid(clientId) && existingNodeIds.has(clientId)) {
      const { error } = await admin.from("marketing_flow_nodes").update(row).eq("id", clientId);
      if (error) throw new Error(`update_node: ${error.message}`);
      clientToDb.set(clientId, clientId);
      keptNodeDbIds.add(clientId);
    } else if (isUuid(clientId)) {
      const { error } = await admin.from("marketing_flow_nodes").insert({ id: clientId, ...row });
      if (error) throw new Error(`insert_node: ${error.message}`);
      clientToDb.set(clientId, clientId);
      keptNodeDbIds.add(clientId);
    } else {
      const { data: inserted, error } = await admin.from("marketing_flow_nodes").insert(row).select("id").single();
      if (error || !inserted) throw new Error(`insert_node: ${error?.message ?? "missing id"}`);
      const dbId = String((inserted as { id: string }).id);
      clientToDb.set(clientId, dbId);
      keptNodeDbIds.add(dbId);
    }
  }

  const nodesToDelete = [...existingNodeIds].filter((id) => !keptNodeDbIds.has(id));

  const resolveNodeRef = (ref: string): string | null => {
    const s = String(ref ?? "").trim();
    if (!s) return null;
    return clientToDb.get(s) ?? null;
  };

  const payloadEdgeDbIds = new Set<string>();
  for (const e of rawEdges) {
    const dbId = parseEdgeDbId(String((e as Record<string, unknown>).id ?? ""));
    if (dbId) payloadEdgeDbIds.add(dbId);
  }

  const edgesToDelete = [...existingEdgeIds].filter((id) => !payloadEdgeDbIds.has(id));
  if (edgesToDelete.length > 0) {
    const { error } = await admin.from("marketing_flow_edges").delete().in("id", edgesToDelete);
    if (error) throw new Error(`delete_edge: ${error.message}`);
  }

  let edgeCount = 0;
  for (const e of rawEdges) {
    const o = e as Record<string, unknown>;
    const clientEdgeId = String(o.id ?? "").trim();
    const src = resolveNodeRef(String(o.source ?? ""));
    const tgt = resolveNodeRef(String(o.target ?? ""));
    if (!src || !tgt) continue;

    const label = encodeEdgeLabel({
      label: o.label != null ? String(o.label) : "",
      sourceHandle: o.sourceHandle != null ? String(o.sourceHandle) : "",
    });
    const edgeRow = { source_node_id: src, target_node_id: tgt, label };
    const dbId = parseEdgeDbId(clientEdgeId);

    if (dbId && existingEdgeIds.has(dbId)) {
      const { error } = await admin.from("marketing_flow_edges").update(edgeRow).eq("id", dbId);
      if (error) throw new Error(`update_edge: ${error.message}`);
    } else {
      const insertRow = dbId ? { id: dbId, ...edgeRow } : edgeRow;
      const { error } = await admin.from("marketing_flow_edges").insert(insertRow);
      if (error) throw new Error(`insert_edge: ${error.message}`);
    }
    edgeCount += 1;
  }

  if (nodesToDelete.length > 0) {
    const { error } = await admin.from("marketing_flow_nodes").delete().in("id", nodesToDelete);
    if (error) throw new Error(`delete_node: ${error.message}`);
  }

  return { nodeCount: keptNodeDbIds.size, edgeCount };
}

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

/** שומר sourceHandle של React Flow בתוך עמודת label (JSON) */
function encodeEdgeLabel(input: { label?: string | null; sourceHandle?: string | null }): string {
  const h = input.sourceHandle?.trim();
  if (h) return JSON.stringify({ _mf: 1, h, t: String(input.label ?? "") });
  return String(input.label ?? "");
}

function decodeEdgeLabel(raw: string): { label?: string; sourceHandle?: string } {
  const s = String(raw ?? "");
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { _mf?: number; h?: string; t?: string };
      if (o && o._mf === 1 && typeof o.h === "string") return { label: String(o.t ?? ""), sourceHandle: o.h };
    } catch {
      /* plain text */
    }
  }
  return { label: s || undefined };
}

export async function GET() {
  console.info("[marketing/flow] GET called");
  if (!(await requireAdmin())) {
    console.warn("[marketing/flow] GET unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();

    const [{ data: nodeRows, error: ne }, { data: edgeRows, error: ee }, { data: settingsRow, error: se }] =
      await Promise.all([
        admin.from("marketing_flow_nodes").select("id, type, data, position_x, position_y").order("id", { ascending: true }),
        admin.from("marketing_flow_edges").select("id, source_node_id, target_node_id, label").order("id", { ascending: true }),
        admin.from("marketing_flow_settings").select("is_active").eq("id", 1).maybeSingle(),
      ]);

    if (ne) { console.error("[marketing/flow] GET nodes error:", ne.message, ne.code, ne.details); return NextResponse.json({ error: ne.message }, { status: 500 }); }
    if (ee) { console.error("[marketing/flow] GET edges error:", ee.message, ee.code, ee.details); return NextResponse.json({ error: ee.message }, { status: 500 }); }
    if (se) { console.error("[marketing/flow] GET settings error:", se.message, se.code, se.details); return NextResponse.json({ error: se.message }, { status: 500 }); }

    const nodes = (nodeRows ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      type: String(row.type ?? "message"),
      position: { x: Number(row.position_x ?? 0), y: Number(row.position_y ?? 0) },
      data: (row.data && typeof row.data === "object" ? row.data : {}) as Record<string, unknown>,
    }));

    const edges = (edgeRows ?? []).map((row: Record<string, unknown>) => {
      const dec = decodeEdgeLabel(String(row.label ?? ""));
      return {
        id: `e_${row.id}`,
        source: String(row.source_node_id),
        target: String(row.target_node_id),
        ...(dec.label ? { label: dec.label } : {}),
        ...(dec.sourceHandle ? { sourceHandle: dec.sourceHandle } : {}),
      };
    });

    const is_active = Boolean((settingsRow as { is_active?: boolean } | null)?.is_active);

    console.info("[marketing/flow] GET ok — nodes:", nodes.length, "edges:", edges.length);
    return NextResponse.json({ nodes, edges, is_active });
  } catch (e) {
    console.error("[marketing/flow] GET exception:", e);
    return NextResponse.json({ error: "get_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  console.info("[marketing/flow] POST called");
  const isAdmin = await requireAdmin();
  if (!isAdmin) {
    console.warn("[marketing/flow] POST unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      nodes?: unknown[];
      edges?: unknown[];
      is_active?: boolean;
    };
    const rawNodes = Array.isArray(body.nodes) ? body.nodes : [];
    const rawEdges = Array.isArray(body.edges) ? body.edges : [];
    console.info("[marketing/flow] POST payload — nodes:", rawNodes.length, "edges:", rawEdges.length, "is_active:", body.is_active);

    const admin = createSupabaseAdminClient();

    let nodeCount = 0;
    let edgeCount = 0;
    try {
      const saved = await persistMarketingFlowGraph(admin, rawNodes, rawEdges);
      nodeCount = saved.nodeCount;
      edgeCount = saved.edgeCount;
    } catch (persistErr) {
      const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      console.error("[marketing/flow] persist:", msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    if (typeof body.is_active === "boolean") {
      const { error: setErr } = await admin
        .from("marketing_flow_settings")
        .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (setErr) console.warn("[marketing/flow] settings update:", setErr.message, setErr.code, setErr.details);
    }

    console.info("[marketing/flow] POST ok — saved", nodeCount, "nodes,", edgeCount, "edges");
    invalidateMarketingFlowCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[marketing/flow] POST exception:", e);
    return NextResponse.json({ error: `save_failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
