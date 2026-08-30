import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import {
  createWabaTemplate,
  syncMarketingWabaTemplatesToDb,
  updateWabaTemplate,
} from "@/lib/meta-templates";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import { isMetaTemplateContentEditable, uniqueTemplateName } from "@/lib/template-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;
const TEMPLATE_SELECT =
  "id, waba_template_id, name, category, language, status, disabled, components, created_at, updated_at";

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const, admin: createSupabaseAdminClient() };
}

async function listCached(admin: ReturnType<typeof createSupabaseAdminClient>) {
  return admin
    .from("marketing_whatsapp_templates")
    .select(TEMPLATE_SELECT)
    .order("updated_at", { ascending: false });
}

/**
 * GET /api/admin/marketing/templates
 * - Plain GET: cache. If empty, sync from Meta once.
 * - ?refresh=1: always sync from Meta (1 Graph list call).
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { admin } = gate;
  const refresh = String(req.nextUrl.searchParams.get("refresh") ?? "").trim() === "1";

  let synced: number | null = null;
  let noRefresh = false;

  const first = await listCached(admin);
  if (first.error) {
    console.error("[admin/marketing/templates] list failed:", first.error.message);
    if (/does not exist|schema cache|marketing_whatsapp_templates/i.test(first.error.message)) {
      return NextResponse.json(
        { error: "migration_required", detail: "הרצי supabase/marketing_admin_templates.sql" },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "template_list_failed" }, { status: 500 });
  }

  const shouldSync = refresh || (first.data?.length ?? 0) === 0;
  if (shouldSync) {
    const wabaId = await resolveMarketingWabaId();
    if (!wabaId) {
      noRefresh = true;
    } else {
      try {
        synced = await syncMarketingWabaTemplatesToDb(admin, wabaId);
      } catch (e) {
        console.error("[admin/marketing/templates] Meta sync failed:", e);
        return NextResponse.json(
          {
            error: "template_sync_failed",
            detail: e instanceof Error ? e.message : String(e),
            templates: first.data ?? [],
          },
          { status: 502 }
        );
      }
    }
  }

  const listed = shouldSync && synced != null ? await listCached(admin) : first;
  if (listed.error) {
    console.error("[admin/marketing/templates] list after sync failed:", listed.error.message);
    return NextResponse.json({ error: "template_list_failed" }, { status: 500 });
  }

  return NextResponse.json({
    templates: listed.data ?? [],
    ...(synced != null ? { synced } : {}),
    ...(noRefresh ? { noRefresh: true } : {}),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { admin } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "MARKETING").trim().toUpperCase() || "MARKETING";
  const language = String(body.language ?? "he").trim().toLowerCase() || "he";
  const components = body.components;

  if (!TEMPLATE_NAME_RE.test(name)) {
    return NextResponse.json({ error: "invalid_template_name" }, { status: 400 });
  }
  if (!Array.isArray(components) || components.length === 0) {
    return NextResponse.json({ error: "missing_components" }, { status: 400 });
  }
  if (category !== "MARKETING" && category !== "UTILITY") {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }

  const wabaId = await resolveMarketingWabaId();
  if (!wabaId) {
    return NextResponse.json({ error: "no_waba" }, { status: 400 });
  }

  const { data: existingNames, error: namesErr } = await admin
    .from("marketing_whatsapp_templates")
    .select("name");
  if (namesErr) {
    console.error("[admin/marketing/templates] names lookup failed:", namesErr.message);
    return NextResponse.json({ error: "template_list_failed" }, { status: 500 });
  }
  const uniqueName = uniqueTemplateName(
    name,
    (existingNames ?? []).map((row) => String((row as { name?: unknown }).name ?? ""))
  );

  let created: { id: string; status: string; category?: string };
  try {
    created = await createWabaTemplate(wabaId, {
      name: uniqueName,
      category,
      language,
      components,
    });
  } catch (e) {
    console.error("[admin/marketing/templates] Meta create failed:", e);
    return NextResponse.json(
      {
        error: "template_create_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  const nowIso = new Date().toISOString();
  const row = {
    waba_template_id: created.id,
    name: uniqueName,
    category: created.category || category,
    language,
    status: created.status || "PENDING",
    components,
    updated_at: nowIso,
  };

  const { data: upserted, error: upsertErr } = await admin
    .from("marketing_whatsapp_templates")
    .upsert(row, { onConflict: "name,language" })
    .select(TEMPLATE_SELECT)
    .maybeSingle();

  if (upsertErr) {
    console.error("[admin/marketing/templates] upsert after create failed:", upsertErr.message);
    return NextResponse.json({ error: "template_upsert_failed" }, { status: 500 });
  }

  return NextResponse.json({ template: upserted ?? row });
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { admin } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const language = String(body.language ?? "").trim();
  const category = String(body.category ?? "").trim().toUpperCase();
  const components = body.components;

  if (!Array.isArray(components) || components.length === 0) {
    return NextResponse.json({ error: "missing_components" }, { status: 400 });
  }
  if (category && category !== "MARKETING" && category !== "UTILITY") {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }

  let lookup = admin.from("marketing_whatsapp_templates").select(TEMPLATE_SELECT);
  if (id) lookup = lookup.eq("id", id);
  else if (name) {
    lookup = lookup.eq("name", name);
    if (language) lookup = lookup.eq("language", language);
  } else {
    return NextResponse.json({ error: "missing_template_ref" }, { status: 400 });
  }

  const { data: existing, error: lookupErr } = await lookup.maybeSingle();
  if (lookupErr) {
    console.error("[admin/marketing/templates] PUT lookup failed:", lookupErr.message);
    return NextResponse.json({ error: "template_lookup_failed" }, { status: 500 });
  }
  if (!existing?.id) {
    return NextResponse.json({ error: "template_not_found" }, { status: 404 });
  }

  const existingStatus = String((existing as { status?: unknown }).status ?? "");
  if (!isMetaTemplateContentEditable(existingStatus)) {
    return NextResponse.json({ error: "template_not_editable" }, { status: 409 });
  }

  const wabaTemplateId = String(
    (existing as { waba_template_id?: unknown }).waba_template_id ?? ""
  ).trim();
  if (!wabaTemplateId) {
    return NextResponse.json({ error: "missing_waba_template_id" }, { status: 400 });
  }

  const existingCategory = String((existing as { category?: unknown }).category ?? "").trim();
  const nextCategory = (category || existingCategory).toUpperCase();
  const statusUpper = existingStatus.toUpperCase();
  if (statusUpper === "APPROVED" && nextCategory && existingCategory && nextCategory !== existingCategory.toUpperCase()) {
    return NextResponse.json({ error: "category_locked" }, { status: 400 });
  }

  let updatedMeta: { category?: string; status?: string };
  try {
    updatedMeta = await updateWabaTemplate(wabaTemplateId, {
      ...(statusUpper === "APPROVED" ? {} : nextCategory ? { category: nextCategory } : {}),
      components,
    });
  } catch (e) {
    console.error("[admin/marketing/templates] Meta update failed:", e);
    return NextResponse.json(
      {
        error: "template_update_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  const nowIso = new Date().toISOString();
  const nextStatus = String(updatedMeta.status ?? "").trim() || "PENDING";
  const { data: updated, error: updErr } = await admin
    .from("marketing_whatsapp_templates")
    .update({
      category: updatedMeta.category || nextCategory || existingCategory,
      components,
      status: nextStatus,
      updated_at: nowIso,
    })
    .eq("id", existing.id)
    .select(TEMPLATE_SELECT)
    .maybeSingle();

  if (updErr) {
    console.error("[admin/marketing/templates] PUT db update failed:", updErr.message);
    return NextResponse.json({ error: "template_upsert_failed" }, { status: 500 });
  }

  return NextResponse.json({ template: updated ?? { ...existing, components, status: nextStatus } });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { admin } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "missing_disabled" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const language = String(body.language ?? "").trim();

  let query = admin.from("marketing_whatsapp_templates").update({
    disabled: body.disabled,
    updated_at: new Date().toISOString(),
  });

  if (id) query = query.eq("id", id);
  else if (name) {
    query = query.eq("name", name);
    if (language) query = query.eq("language", language);
  } else {
    return NextResponse.json({ error: "missing_template_ref" }, { status: 400 });
  }

  const { data: updatedRows, error: updErr } = await query.select(TEMPLATE_SELECT);
  if (updErr) {
    console.error("[admin/marketing/templates] PATCH failed:", updErr.message);
    return NextResponse.json({ error: "template_disable_failed" }, { status: 500 });
  }
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
  if (!updated?.id) {
    return NextResponse.json({ error: "template_not_found" }, { status: 404 });
  }
  return NextResponse.json({ template: updated });
}
