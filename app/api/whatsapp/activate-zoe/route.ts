import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

type Body = {
  business_slug?: string;
  activate?: boolean;
};

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Owner: turn Zoe's auto-reply on/off for the business — businesses.zoe_activated.
 * Independent of whatsapp_channels.is_active and paused_sessions.
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
  if (typeof body.activate !== "boolean") {
    return NextResponse.json({ error: "missing_activate" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(admin, { id: user.id, email: user.email }, businessSlug);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (body.activate === true) {
    const businessId = Number(access.business.id);
    let hasConnectedNumber = false;

    {
      const { data: bySlug } = await admin
        .from("whatsapp_channels")
        .select("id, phone_display")
        .eq("business_slug", businessSlug)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (String((bySlug as { phone_display?: unknown } | null)?.phone_display ?? "").trim()) {
        hasConnectedNumber = true;
      }
    }

    if (!hasConnectedNumber && Number.isFinite(businessId) && businessId > 0) {
      const { data: byId } = await admin
        .from("whatsapp_channels")
        .select("id, phone_display")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (String((byId as { phone_display?: unknown } | null)?.phone_display ?? "").trim()) {
        hasConnectedNumber = true;
      }
    }

    if (!hasConnectedNumber) {
      console.warn("[api/whatsapp/activate-zoe] blocked: no connected WhatsApp number", {
        business_id: businessId,
        slug: businessSlug,
      });
      return NextResponse.json({ error: "no_whatsapp_number" }, { status: 400 });
    }
  }

  const { error: updateErr } = await admin
    .from("businesses")
    .update({ zoe_activated: body.activate })
    .eq("id", access.business.id);

  if (updateErr) {
    console.error("[api/whatsapp/activate-zoe] update failed:", updateErr);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  console.info("[api/whatsapp/activate-zoe] zoe_activated set", {
    business_id: access.business.id,
    slug: businessSlug,
    activate: body.activate,
  });

  return NextResponse.json({ ok: true, zoe_activated: body.activate });
}
