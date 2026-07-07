import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

type Body = {
  business_slug?: string;
};

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Owner: best-effort disconnect — whatsapp_channels.is_active=false for the business only.
 * Does not change businesses.is_active.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const businessSlug = String(body.business_slug ?? "").trim().toLowerCase();
  if (!businessSlug) {
    return NextResponse.json({ error: "missing_business_slug" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(admin, { id: user.id, email: user.email }, businessSlug);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const businessId = access.business.id;

  const { data: channels, error: listErr } = await admin
    .from("whatsapp_channels")
    .select("id, is_active")
    .eq("business_id", businessId);

  if (listErr) {
    console.error("[api/account/disconnect-whatsapp] list channels failed:", listErr);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  const activeCount = (channels ?? []).filter((c) => (c as { is_active?: boolean }).is_active === true).length;
  if (activeCount === 0) {
    console.info("[api/account/disconnect-whatsapp] no active channels", { business_id: businessId, slug: businessSlug });
    return NextResponse.json({ ok: true, status: "already_disconnected", deactivated: 0 });
  }

  const { error: updateErr } = await admin
    .from("whatsapp_channels")
    .update({ is_active: false } as any)
    .eq("business_id", businessId);

  if (updateErr) {
    console.error("[api/account/disconnect-whatsapp] deactivate failed:", updateErr);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  console.info("[api/account/disconnect-whatsapp] deactivated", {
    business_id: businessId,
    slug: businessSlug,
    deactivated: activeCount,
  });

  return NextResponse.json({ ok: true, status: "disconnected", deactivated: activeCount });
}
