import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { createWabaTemplate, syncWabaTemplatesToDb } from "@/lib/meta-templates";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;

async function requireTemplatesAccess(slug: string) {
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

/**
 * GET /api/[slug]/templates
 * - Plain GET: cached rows from whatsapp_templates only (no Meta call).
 * - ?refresh=1: sync from Meta first (skipped if businesses.waba_id empty → noRefresh:true).
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const refresh =
    String(req.nextUrl.searchParams.get("refresh") ?? "").trim() === "1";

  const gate = await requireTemplatesAccess(slug);
  if (!gate.ok) return gate.response;
  const { admin, business } = gate;
  const businessId = business.id;
  let synced: number | null = null;
  let noRefresh = false;

  if (refresh) {
    const { data: bizRow, error: bizErr } = await admin
      .from("businesses")
      .select("waba_id")
      .eq("id", businessId)
      .maybeSingle();
    if (bizErr) {
      console.error("[api/templates] waba_id lookup failed:", bizErr.message);
      return NextResponse.json({ error: "business_lookup_failed" }, { status: 500 });
    }
    const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
      .trim()
      .replace(/\s+/g, "");
    if (!wabaId) {
      noRefresh = true;
    } else {
      try {
        synced = await syncWabaTemplatesToDb(admin, businessId, wabaId);
      } catch (e) {
        console.error("[api/templates] Meta sync failed:", e);
        return NextResponse.json(
          {
            error: "template_sync_failed",
            detail: e instanceof Error ? e.message : String(e),
          },
          { status: 502 }
        );
      }
    }
  }

  const [{ data: templates, error: listErr }, { data: bizMeta }] = await Promise.all([
    admin
      .from("whatsapp_templates")
      .select(
        "id, business_id, waba_template_id, name, category, language, status, components, created_at, updated_at"
      )
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false }),
    admin
      .from("businesses")
      .select("lead_template_name")
      .eq("id", businessId)
      .maybeSingle(),
  ]);

  if (listErr) {
    console.error("[api/templates] list failed:", listErr.message);
    return NextResponse.json({ error: "template_list_failed" }, { status: 500 });
  }

  return NextResponse.json({
    templates: templates ?? [],
    lead_template_name: String(
      (bizMeta as { lead_template_name?: unknown } | null)?.lead_template_name ?? ""
    ).trim() || null,
    ...(synced != null ? { synced } : {}),
    ...(noRefresh ? { noRefresh: true } : {}),
  });
}

/**
 * POST /api/[slug]/templates — create a Meta message template + cache row.
 * Body: { name, category?, language?, components }
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const gate = await requireTemplatesAccess(slug);
  if (!gate.ok) return gate.response;
  const { admin, business } = gate;

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

  const { data: bizRow, error: bizErr } = await admin
    .from("businesses")
    .select("waba_id")
    .eq("id", business.id)
    .maybeSingle();
  if (bizErr) {
    console.error("[api/templates] POST waba_id lookup failed:", bizErr.message);
    return NextResponse.json({ error: "business_lookup_failed" }, { status: 500 });
  }
  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!wabaId) {
    return NextResponse.json({ error: "no_waba" }, { status: 400 });
  }

  let created: { id: string; status: string; category?: string };
  try {
    created = await createWabaTemplate(wabaId, {
      name,
      category,
      language,
      components,
    });
  } catch (e) {
    console.error("[api/templates] Meta create failed:", e);
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
    business_id: business.id,
    waba_template_id: created.id,
    name,
    category: created.category || category,
    language,
    status: created.status || "PENDING",
    components,
    updated_at: nowIso,
  };

  const { data: upserted, error: upsertErr } = await admin
    .from("whatsapp_templates")
    .upsert(row, { onConflict: "business_id,name,language" })
    .select(
      "id, business_id, waba_template_id, name, category, language, status, components, created_at, updated_at"
    )
    .maybeSingle();

  if (upsertErr) {
    console.error("[api/templates] upsert after create failed:", upsertErr.message);
    return NextResponse.json({ error: "template_upsert_failed" }, { status: 500 });
  }

  return NextResponse.json({ template: upserted ?? row });
}
