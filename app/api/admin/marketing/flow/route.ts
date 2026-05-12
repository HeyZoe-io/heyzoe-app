import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NODE_TYPES = new Set(["message", "question", "media", "cta", "followup"]);

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

    const { error: delE } = await admin.from("marketing_flow_edges").delete().neq("id", -1);
    if (delE) { console.error("[marketing/flow] delete edges:", delE.message, delE.code, delE.details); return NextResponse.json({ error: `delete_edges: ${delE.message}` }, { status: 500 }); }

    const { error: delN } = await admin.from("marketing_flow_nodes").delete().neq("id", -1);
    if (delN) { console.error("[marketing/flow] delete nodes:", delN.message, delN.code, delN.details); return NextResponse.json({ error: `delete_nodes: ${delN.message}` }, { status: 500 }); }

    if (rawNodes.length === 0) {
      if (typeof body.is_active === "boolean") {
        await admin
          .from("marketing_flow_settings")
          .upsert({ id: 1, is_active: body.is_active, updated_at: new Date().toISOString() }, { onConflict: "id" });
      }
      console.info("[marketing/flow] POST ok (empty flow)");
      return NextResponse.json({ ok: true });
    }

    const insertRows = rawNodes.map((n) => {
      const o = n as Record<string, unknown>;
      const type = String(o.type ?? "message");
      const safeType = NODE_TYPES.has(type) ? type : "message";
      const pos = (o.position && typeof o.position === "object" ? (o.position as Record<string, unknown>) : {}) as Record<
        string,
        unknown
      >;
      const data = o.data && typeof o.data === "object" ? o.data : {};
      return {
        type: safeType,
        data,
        position_x: Number(pos.x ?? 0),
        position_y: Number(pos.y ?? 0),
      };
    });

    const { data: inserted, error: insErr } = await admin.from("marketing_flow_nodes").insert(insertRows).select("id");
    if (insErr) { console.error("[marketing/flow] insert nodes:", insErr.message, insErr.code, insErr.details); return NextResponse.json({ error: `insert_nodes: ${insErr.message}` }, { status: 500 }); }
    if (!inserted || inserted.length !== rawNodes.length) {
      console.error("[marketing/flow] insert count mismatch — expected:", rawNodes.length, "got:", inserted?.length);
      return NextResponse.json({ error: "insert_count_mismatch" }, { status: 500 });
    }

    const oldIdToNewId = new Map<string, string>();
    rawNodes.forEach((n, i) => {
      const oldId = String((n as Record<string, unknown>).id ?? "");
      const newId = String((inserted[i] as { id: number }).id);
      if (oldId) oldIdToNewId.set(oldId, newId);
    });

    const edgeInserts: { source_node_id: number; target_node_id: number; label: string }[] = [];
    for (const e of rawEdges) {
      const o = e as Record<string, unknown>;
      const src = oldIdToNewId.get(String(o.source ?? ""));
      const tgt = oldIdToNewId.get(String(o.target ?? ""));
      if (!src || !tgt) continue;
      const label = encodeEdgeLabel({
        label: o.label != null ? String(o.label) : "",
        sourceHandle: o.sourceHandle != null ? String(o.sourceHandle) : "",
      });
      edgeInserts.push({
        source_node_id: Number(src),
        target_node_id: Number(tgt),
        label,
      });
    }

    if (edgeInserts.length > 0) {
      const { error: edgeErr } = await admin.from("marketing_flow_edges").insert(edgeInserts);
      if (edgeErr) { console.error("[marketing/flow] insert edges:", edgeErr.message, edgeErr.code, edgeErr.details); return NextResponse.json({ error: `insert_edges: ${edgeErr.message}` }, { status: 500 }); }
    }

    if (typeof body.is_active === "boolean") {
      const { error: setErr } = await admin
        .from("marketing_flow_settings")
        .upsert({ id: 1, is_active: body.is_active, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (setErr) console.warn("[marketing/flow] settings upsert:", setErr.message, setErr.code, setErr.details);
    }

    console.info("[marketing/flow] POST ok — saved", rawNodes.length, "nodes,", edgeInserts.length, "edges");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[marketing/flow] POST exception:", e);
    return NextResponse.json({ error: `save_failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
