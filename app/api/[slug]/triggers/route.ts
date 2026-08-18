import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { businessHasArboxConnection } from "@/lib/crm/types";
import {
  canonicalizeTriggerType,
  INCOMING_LEAD_TRIGGER_TYPES_RESOLVE,
  isArboxDependentTriggerType,
  isIncomingLeadTriggerType,
  isTriggerType,
  type TriggerType,
} from "@/lib/template-trigger-types";

/** incoming_lead (and legacy) / no_response / arbox_new_lead: force after + no product_filter. */
function forcesAfterNoProductFilter(triggerType: string): boolean {
  return (
    isIncomingLeadTriggerType(triggerType) ||
    triggerType === "no_response" ||
    triggerType === "arbox_new_lead"
  );
}

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

const DELAY_DIRECTIONS = ["after", "before"] as const;

type DelayDirection = (typeof DELAY_DIRECTIONS)[number];

type TriggerRow = {
  id: number;
  business_id: number;
  trigger_type: TriggerType;
  product_filter: number[] | null;
  delay_days: number;
  delay_direction: DelayDirection;
  template_name: string | null;
  enabled: boolean;
  created_at: string;
};

async function requireTriggersAccess(slug: string) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug
  );
  if (!access.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: access.error }, { status: access.status }),
    };
  }
  return { ok: true as const, admin, business: access.business };
}

async function loadBusinessHasArbox(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<boolean> {
  const { data, error } = await admin
    .from("businesses")
    .select("crm_type, crm_api_key")
    .eq("id", businessId)
    .maybeSingle();
  if (error) {
    console.error("[api/triggers] crm lookup failed:", error.message);
    return false;
  }
  return businessHasArboxConnection(data);
}

function isDelayDirection(value: string): value is DelayDirection {
  return (DELAY_DIRECTIONS as readonly string[]).includes(value);
}

function parseProductFilter(raw: unknown): number[] | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return "invalid";
  const ids: number[] = [];
  for (const item of raw) {
    const n = Number(item);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return "invalid";
    ids.push(n);
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

function parseDelayDays(raw: unknown): number | "invalid" {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return "invalid";
  return n;
}

async function verifyTriggerTemplate(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  templateName: string,
  opts?: { allowPending?: boolean }
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const name = templateName.trim();
  if (!name) {
    return { ok: false, error: "missing_template_name", status: 400 };
  }

  const { data: approved, error: lookupErr } = await admin
    .from("whatsapp_templates")
    .select("id, name, status, disabled")
    .eq("business_id", businessId)
    .eq("name", name)
    .eq("status", "APPROVED")
    .eq("disabled", false)
    .limit(1)
    .maybeSingle();

  if (lookupErr) {
    console.error("[api/triggers] template lookup failed:", lookupErr.message);
    return { ok: false, error: "template_lookup_failed", status: 500 };
  }
  if (approved?.id) return { ok: true };

  const { data: anyStatus } = await admin
    .from("whatsapp_templates")
    .select("id, status, disabled")
    .eq("business_id", businessId)
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (!anyStatus?.id) {
    return { ok: false, error: "template_not_found", status: 404 };
  }
  if ((anyStatus as { disabled?: boolean }).disabled === true) {
    return { ok: false, error: "template_disabled", status: 400 };
  }
  const status = String((anyStatus as { status?: unknown }).status ?? "")
    .trim()
    .toUpperCase();
  if (opts?.allowPending && status === "PENDING") {
    return { ok: true };
  }
  return { ok: false, error: "template_not_approved", status: 400 };
}

function normalizeTriggerRow(row: Record<string, unknown>): TriggerRow {
  const productFilter = parseProductFilter(row.product_filter);
  const rawType = String(row.trigger_type ?? "");
  return {
    id: Number(row.id),
    business_id: Number(row.business_id),
    trigger_type: canonicalizeTriggerType(rawType) as TriggerType,
    product_filter: productFilter === "invalid" ? null : productFilter,
    delay_days: Number(row.delay_days ?? 0),
    delay_direction: String(row.delay_direction ?? "after") as DelayDirection,
    template_name: row.template_name != null ? String(row.template_name) : null,
    enabled: Boolean(row.enabled),
    created_at: String(row.created_at ?? ""),
  };
}

/** At most one incoming_lead (incl. legacy site_lead/campaign_lead) row per business. */
async function findExistingIncomingLeadRule(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  excludeId?: number
): Promise<{ id: number } | null> {
  let q = admin
    .from("template_triggers")
    .select("id")
    .eq("business_id", businessId)
    .in("trigger_type", [...INCOMING_LEAD_TRIGGER_TYPES_RESOLVE])
    .limit(1);
  if (excludeId != null && Number.isFinite(excludeId)) {
    q = q.neq("id", excludeId);
  }
  const { data, error } = await q;
  if (error) {
    console.error("[api/triggers] incoming_lead uniqueness lookup failed:", error.message);
    throw new Error("incoming_lead_lookup_failed");
  }
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row?.id) return null;
  return { id: Number(row.id) };
}

const TRIGGER_SELECT =
  "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at";

/**
 * GET /api/[slug]/triggers — list automation rules for the business.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireTriggersAccess(slug);
  if (!gate.ok) return gate.response;
  const { admin, business } = gate;

  const { data, error } = await admin
    .from("template_triggers")
    .select(TRIGGER_SELECT)
    .eq("business_id", business.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[api/triggers] list failed:", error.message);
    return NextResponse.json({ error: "trigger_list_failed" }, { status: 500 });
  }

  const triggers = (data ?? []).map((row) =>
    normalizeTriggerRow(row as Record<string, unknown>)
  );
  return NextResponse.json({ triggers });
}

/**
 * POST /api/[slug]/triggers — create an automation rule.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireTriggersAccess(slug);
  if (!gate.ok) return gate.response;
  const { admin, business } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const triggerType = String(body.trigger_type ?? "").trim();
  if (!isTriggerType(triggerType)) {
    return NextResponse.json({ error: "invalid_trigger_type" }, { status: 400 });
  }

  if (isArboxDependentTriggerType(triggerType)) {
    const hasArbox = await loadBusinessHasArbox(admin, business.id);
    if (!hasArbox) {
      return NextResponse.json({ error: "arbox_not_connected" }, { status: 400 });
    }
  }

  if (isIncomingLeadTriggerType(triggerType)) {
    try {
      const existing = await findExistingIncomingLeadRule(admin, business.id);
      if (existing) {
        return NextResponse.json(
          { error: "incoming_lead_exists", message: "כבר קיים טריגר ליד" },
          { status: 409 }
        );
      }
    } catch {
      return NextResponse.json({ error: "incoming_lead_lookup_failed" }, { status: 500 });
    }
  }

  let delayDirection = String(body.delay_direction ?? "").trim();
  if (forcesAfterNoProductFilter(triggerType)) {
    delayDirection = "after";
  }
  if (!isDelayDirection(delayDirection)) {
    return NextResponse.json({ error: "invalid_delay_direction" }, { status: 400 });
  }

  const delayDays = parseDelayDays(body.delay_days);
  if (delayDays === "invalid") {
    return NextResponse.json({ error: "invalid_delay_days" }, { status: 400 });
  }
  if (triggerType === "no_response" && delayDays < 2) {
    return NextResponse.json({ error: "min_delay_days" }, { status: 400 });
  }

  let productFilter = parseProductFilter(body.product_filter);
  if (productFilter === "invalid") {
    return NextResponse.json({ error: "invalid_product_filter" }, { status: 400 });
  }
  if (forcesAfterNoProductFilter(triggerType)) {
    productFilter = null;
  }

  const templateNameRaw = body.template_name;
  const templateName =
    templateNameRaw == null || String(templateNameRaw).trim() === ""
      ? null
      : String(templateNameRaw).trim();

  if (templateName) {
    const verified = await verifyTriggerTemplate(admin, business.id, templateName, {
      allowPending: triggerType === "arbox_new_lead",
    });
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }
  }

  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

  const insertRow = {
    business_id: business.id,
    trigger_type: triggerType,
    product_filter: productFilter,
    delay_days: delayDays,
    delay_direction: delayDirection,
    template_name: templateName,
    enabled,
  };

  const { data: created, error: insertErr } = await admin
    .from("template_triggers")
    .insert(insertRow)
    .select(TRIGGER_SELECT)
    .maybeSingle();

  if (insertErr) {
    console.error("[api/triggers] insert failed:", insertErr.message);
    return NextResponse.json({ error: "trigger_create_failed" }, { status: 500 });
  }

  return NextResponse.json({
    trigger: normalizeTriggerRow((created ?? insertRow) as Record<string, unknown>),
  });
}

/**
 * PATCH /api/[slug]/triggers — update a rule by id (scoped to business).
 * Body: { id, ...fields }
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireTriggersAccess(slug);
  if (!gate.ok) return gate.response;
  const { admin, business } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.trigger_type !== undefined) {
    const triggerType = String(body.trigger_type).trim();
    if (!isTriggerType(triggerType)) {
      return NextResponse.json({ error: "invalid_trigger_type" }, { status: 400 });
    }
    if (isArboxDependentTriggerType(triggerType)) {
      const hasArbox = await loadBusinessHasArbox(admin, business.id);
      if (!hasArbox) {
        return NextResponse.json({ error: "arbox_not_connected" }, { status: 400 });
      }
    }
    patch.trigger_type = triggerType;
    if (forcesAfterNoProductFilter(triggerType)) {
      patch.delay_direction = "after";
      patch.product_filter = null;
    }
  }

  if (body.delay_direction !== undefined) {
    let delayDirection = String(body.delay_direction).trim();
    if (
      patch.trigger_type != null &&
      forcesAfterNoProductFilter(String(patch.trigger_type))
    ) {
      delayDirection = "after";
    }
    if (!isDelayDirection(delayDirection)) {
      return NextResponse.json({ error: "invalid_delay_direction" }, { status: 400 });
    }
    patch.delay_direction = delayDirection;
  }

  if (body.delay_days !== undefined) {
    const delayDays = parseDelayDays(body.delay_days);
    if (delayDays === "invalid") {
      return NextResponse.json({ error: "invalid_delay_days" }, { status: 400 });
    }
    patch.delay_days = delayDays;
  }

  if (body.product_filter !== undefined) {
    const productFilter = parseProductFilter(body.product_filter);
    if (productFilter === "invalid") {
      return NextResponse.json({ error: "invalid_product_filter" }, { status: 400 });
    }
    patch.product_filter =
      patch.trigger_type != null && forcesAfterNoProductFilter(String(patch.trigger_type))
        ? null
        : productFilter;
  }

  if (body.template_name !== undefined) {
    const templateName =
      body.template_name == null || String(body.template_name).trim() === ""
        ? null
        : String(body.template_name).trim();
    if (templateName) {
      let effectiveType =
        patch.trigger_type != null ? String(patch.trigger_type) : null;
      if (effectiveType == null) {
        const { data: existing } = await admin
          .from("template_triggers")
          .select("trigger_type")
          .eq("id", id)
          .eq("business_id", business.id)
          .maybeSingle();
        effectiveType = String((existing as { trigger_type?: unknown } | null)?.trigger_type ?? "");
      }
      const verified = await verifyTriggerTemplate(admin, business.id, templateName, {
        allowPending: effectiveType === "arbox_new_lead",
      });
      if (!verified.ok) {
        return NextResponse.json({ error: verified.error }, { status: verified.status });
      }
    }
    patch.template_name = templateName;
  }

  if (body.enabled !== undefined) {
    patch.enabled = Boolean(body.enabled);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  // Changing type → incoming_lead: still only one row allowed per business.
  if (patch.trigger_type != null && isIncomingLeadTriggerType(String(patch.trigger_type))) {
    try {
      const existing = await findExistingIncomingLeadRule(admin, business.id, id);
      if (existing) {
        return NextResponse.json(
          { error: "incoming_lead_exists", message: "כבר קיים טריגר ליד" },
          { status: 409 }
        );
      }
    } catch {
      return NextResponse.json({ error: "incoming_lead_lookup_failed" }, { status: 500 });
    }
  }

  // Enforce no_response min delay against the effective type after patch.
  if (patch.delay_days !== undefined || patch.trigger_type === "no_response") {
    let effectiveType = patch.trigger_type != null ? String(patch.trigger_type) : null;
    let effectiveDelay =
      patch.delay_days !== undefined ? Number(patch.delay_days) : null;
    if (effectiveType == null || effectiveDelay == null) {
      const { data: existing } = await admin
        .from("template_triggers")
        .select("trigger_type, delay_days")
        .eq("id", id)
        .eq("business_id", business.id)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json({ error: "trigger_not_found" }, { status: 404 });
      }
      if (effectiveType == null) effectiveType = String(existing.trigger_type ?? "");
      if (effectiveDelay == null) effectiveDelay = Number(existing.delay_days ?? 0);
    }
    if (effectiveType === "no_response" && (effectiveDelay ?? 0) < 2) {
      return NextResponse.json({ error: "min_delay_days" }, { status: 400 });
    }
  }

  const { data: updated, error: updErr } = await admin
    .from("template_triggers")
    .update(patch)
    .eq("id", id)
    .eq("business_id", business.id)
    .select(TRIGGER_SELECT)
    .maybeSingle();

  if (updErr) {
    console.error("[api/triggers] update failed:", updErr.message);
    return NextResponse.json({ error: "trigger_update_failed" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "trigger_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    trigger: normalizeTriggerRow(updated as Record<string, unknown>),
  });
}

/**
 * DELETE /api/[slug]/triggers?id= — delete a rule by id (scoped to business).
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireTriggersAccess(slug);
  if (!gate.ok) return gate.response;
  const { admin, business } = gate;

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const { data: deleted, error: delErr } = await admin
    .from("template_triggers")
    .delete()
    .eq("id", id)
    .eq("business_id", business.id)
    .select("id")
    .maybeSingle();

  if (delErr) {
    console.error("[api/triggers] delete failed:", delErr.message);
    return NextResponse.json({ error: "trigger_delete_failed" }, { status: 500 });
  }
  if (!deleted) {
    return NextResponse.json({ error: "trigger_not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
