import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

async function deleteAllEdges(admin: ReturnType<typeof createSupabaseAdminClient>) {
  for (;;) {
    const { data } = await admin.from("marketing_flow_edges").select("id").limit(300);
    if (!data?.length) break;
    await admin.from("marketing_flow_edges").delete().in(
      "id",
      data.map((r: any) => r.id)
    );
  }
}

async function deleteAllNodes(admin: ReturnType<typeof createSupabaseAdminClient>) {
  for (;;) {
    const { data } = await admin.from("marketing_flow_nodes").select("id").limit(300);
    if (!data?.length) break;
    await admin.from("marketing_flow_nodes").delete().in(
      "id",
      data.map((r: any) => r.id)
    );
  }
}

type SaveNode = {
  type: string;
  data?: Record<string, unknown>;
  position?: { x?: number; y?: number };
  is_start?: boolean;
};

type SaveEdge = {
  fromIndex: number;
  toIndex: number;
  label?: string;
};

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    nodes?: SaveNode[];
    edges?: SaveEdge[];
    rootIndex?: number;
  } | null;
  const nodesIn = Array.isArray(body?.nodes) ? body!.nodes! : [];
  const edgesIn = Array.isArray(body?.edges) ? body!.edges! : [];
  if (!nodesIn.length) {
    return NextResponse.json({ error: "nodes_required" }, { status: 400 });
  }

  const allowed = new Set(["message", "question", "media", "cta", "followup"]);
  for (const n of nodesIn) {
    if (!allowed.has(String(n.type))) {
      return NextResponse.json({ error: `invalid_node_type:${n.type}` }, { status: 400 });
    }
  }

  const admin = createSupabaseAdminClient();

  const { data: sessionIds } = await admin.from("marketing_flow_sessions").select("id");
  const sids = (sessionIds ?? []).map((r: any) => r.id).filter((id: any) => id != null);
  if (sids.length) {
    await admin
      .from("marketing_flow_sessions")
      .update({
        current_node_id: null,
        followup_wake_at: null,
        followup_next_node_id: null,
        updated_at: new Date().toISOString(),
      } as any)
      .in("id", sids);
  }

  await deleteAllEdges(admin);
  await deleteAllNodes(admin);

  const startIdx = nodesIn.findIndex((n) => Boolean(n.is_start));
  const rows = nodesIn.map((n, i) => ({
    type: n.type,
    data: n.data ?? {},
    position_x: Number(n.position?.x ?? 0) || 0,
    position_y: Number(n.position?.y ?? 0) || 0,
    is_start: startIdx === i,
    updated_at: new Date().toISOString(),
  }));

  const { data: inserted, error: insErr } = await admin.from("marketing_flow_nodes").insert(rows as any).select("id");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  const ids = (inserted ?? []).map((r: any) => Number(r.id));

  const edgeRows = edgesIn
    .map((e) => {
      const s = ids[e.fromIndex];
      const t = ids[e.toIndex];
      if (!Number.isFinite(s) || !Number.isFinite(t)) return null;
      return {
        source_node_id: s,
        target_node_id: t,
        label: String(e.label ?? ""),
      };
    })
    .filter(Boolean) as { source_node_id: number; target_node_id: number; label: string }[];

  if (edgeRows.length) {
    const { error: eErr } = await admin.from("marketing_flow_edges").insert(edgeRows as any);
    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });
  }

  const ri = Number(body?.rootIndex ?? 0);
  const rootId = Number.isFinite(ri) && ids[ri] != null ? ids[ri]! : ids[0]!;
  const { error: setErr } = await admin
    .from("marketing_flow_settings")
    .update({ root_node_id: rootId, updated_at: new Date().toISOString() } as any)
    .eq("id", 1);
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, nodeIds: ids, root_node_id: rootId });
}
