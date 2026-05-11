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
  if (!(await requireAdmin())) {
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

    if (ne) return NextResponse.json({ error: ne.message }, { status: 500 });
    if (ee) return NextResponse.json({ error: ee.message }, { status: 500 });
    if (se) return NextResponse.json({ error: se.message }, { status: 500 });

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

    return NextResponse.json({ nodes, edges, is_active });
  } catch (e) {
    console.error("[api/admin/marketing/flow] GET:", e);
    return NextResponse.json({ error: "get_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
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

    const admin = createSupabaseAdminClient();

    const { error: delE } = await admin.from("marketing_flow_edges").delete().neq("id", -1);
    if (delE) return NextResponse.json({ error: delE.message }, { status: 500 });

    const { error: delN } = await admin.from("marketing_flow_nodes").delete().neq("id", -1);
    if (delN) return NextResponse.json({ error: delN.message }, { status: 500 });

    if (rawNodes.length === 0) {
      if (typeof body.is_active === "boolean") {
        await admin
          .from("marketing_flow_settings")
          .upsert({ id: 1, is_active: body.is_active, updated_at: new Date().toISOString() }, { onConflict: "id" });
      }
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
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    if (!inserted || inserted.length !== rawNodes.length) {
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
      if (edgeErr) return NextResponse.json({ error: edgeErr.message }, { status: 500 });
    }

    if (typeof body.is_active === "boolean") {
      const { error: setErr } = await admin
        .from("marketing_flow_settings")
        .upsert({ id: 1, is_active: body.is_active, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (setErr) console.warn("[api/admin/marketing/flow] settings upsert:", setErr.message);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/marketing/flow] POST:", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
