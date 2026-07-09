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
