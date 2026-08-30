import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import {
  isMarketingTriggerType,
  marketingDelayDirectionForTrigger,
  marketingForcesDelayAfter,
  parseMarketingTriggerId,
  type MarketingTriggerType,
} from "@/lib/marketing-template-trigger-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DELAY_DIRECTIONS = ["after", "before"] as const;
type DelayDirection = (typeof DELAY_DIRECTIONS)[number];

const SELECT =
  "id, trigger_type, flow_node_id, delay_days, delay_direction, template_name, enabled, created_at, updated_at";

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const, admin: createSupabaseAdminClient() };
}

function isDelayDirection(value: string): value is DelayDirection {
  return (DELAY_DIRECTIONS as readonly string[]).includes(value);
}

function parseDelayDays(raw: unknown): number | "invalid" {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return "invalid";
  return n;
}

async function verifyTemplate(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  templateName: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const name = templateName.trim();
  if (!name) return { ok: false, error: "missing_template_name", status: 400 };

  const { data: approved, error: lookupErr } = await admin
    .from("marketing_whatsapp_templates")
    .select("id, name, status, disabled")
    .eq("name", name)
    .eq("status", "APPROVED")
    .eq("disabled", false)
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    console.error("[admin/marketing/triggers] template lookup failed:", lookupErr.message);
    return { ok: false, error: "template_lookup_failed", status: 500 };
  }
  if (approved?.id) return { ok: true };

  const { data: anyStatus } = await admin
    .from("marketing_whatsapp_templates")
    .select("id, status, disabled")
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (!anyStatus?.id) return { ok: false, error: "template_not_found", status: 404 };
  if ((anyStatus as { disabled?: boolean }).disabled === true) {
    return { ok: false, error: "template_disabled", status: 400 };
  }
  const status = String((anyStatus as { status?: unknown }).status ?? "").trim().toUpperCase();
  if (status === "PENDING") return { ok: true };
  return { ok: false, error: "template_not_approved", status: 400 };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.admin
    .from("marketing_template_triggers")
    .select(SELECT)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[admin/marketing/triggers] list failed:", error.message);
    if (/does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json(
        { error: "migration_required", detail: "הרצי supabase/marketing_admin_templates.sql" },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "trigger_list_failed" }, { status: 500 });
  }
  return NextResponse.json({ triggers: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const triggerType = String(body.trigger_type ?? "").trim();
  if (!isMarketingTriggerType(triggerType)) {
    return NextResponse.json({ error: "invalid_trigger_type" }, { status: 400 });
  }
  const templateName = String(body.template_name ?? "").trim();
  const verified = await verifyTemplate(gate.admin, templateName);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }

  const delayDays = parseDelayDays(body.delay_days ?? 0);
  if (delayDays === "invalid") {
    return NextResponse.json({ error: "invalid_delay_days" }, { status: 400 });
  }
  const delayDirection = marketingDelayDirectionForTrigger(
    triggerType,
    isDelayDirection(String(body.delay_direction ?? "")) ? String(body.delay_direction) : "after"
  );
  const flowNodeId = String(body.flow_node_id ?? "").trim() || null;
  if (triggerType === "node_answered" && !flowNodeId) {
    return NextResponse.json({ error: "missing_flow_node_id" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await gate.admin
    .from("marketing_template_triggers")
    .insert({
      trigger_type: triggerType as MarketingTriggerType,
      flow_node_id: flowNodeId,
      delay_days: delayDays,
      delay_direction: marketingForcesDelayAfter(triggerType) ? "after" : delayDirection,
      template_name: templateName,
      enabled: body.enabled === false ? false : true,
      updated_at: nowIso,
    })
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.error("[admin/marketing/triggers] insert failed:", error.message);
    return NextResponse.json({ error: "trigger_create_failed" }, { status: 500 });
  }
  return NextResponse.json({ trigger: data });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = parseMarketingTriggerId(body.id);
  if (!id) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "invalid_enabled" }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }
  if (body.template_name !== undefined) {
    const templateName = String(body.template_name ?? "").trim();
    const verified = await verifyTemplate(gate.admin, templateName);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }
    patch.template_name = templateName;
  }
  if (body.delay_days !== undefined) {
    const delayDays = parseDelayDays(body.delay_days);
    if (delayDays === "invalid") {
      return NextResponse.json({ error: "invalid_delay_days" }, { status: 400 });
    }
    patch.delay_days = delayDays;
  }
  if (body.delay_direction !== undefined) {
    const d = String(body.delay_direction ?? "").trim();
    if (!isDelayDirection(d)) {
      return NextResponse.json({ error: "invalid_delay_direction" }, { status: 400 });
    }
    patch.delay_direction = d;
  }
  if (body.flow_node_id !== undefined) {
    patch.flow_node_id = String(body.flow_node_id ?? "").trim() || null;
  }
  if (body.trigger_type !== undefined) {
    const triggerType = String(body.trigger_type ?? "").trim();
    if (!isMarketingTriggerType(triggerType)) {
      return NextResponse.json({ error: "invalid_trigger_type" }, { status: 400 });
    }
    patch.trigger_type = triggerType;
  }

  const { data, error } = await gate.admin
    .from("marketing_template_triggers")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .maybeSingle();
  if (error) {
    console.error("[admin/marketing/triggers] update failed:", error.message);
    return NextResponse.json({ error: "trigger_update_failed" }, { status: 500 });
  }
  if (!data?.id) return NextResponse.json({ error: "trigger_not_found" }, { status: 404 });
  return NextResponse.json({ trigger: data });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = parseMarketingTriggerId(body.id);
  if (!id) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const { error } = await gate.admin.from("marketing_template_triggers").delete().eq("id", id);
  if (error) {
    console.error("[admin/marketing/triggers] delete failed:", error.message);
    return NextResponse.json({ error: "trigger_delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
