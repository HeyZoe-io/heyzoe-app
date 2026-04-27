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

// GET /api/admin/whatsapp/channels — list all channels
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_channels")
    .select("id, business_slug, phone_number_id, phone_display, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channels: data ?? [] });
}

// POST /api/admin/whatsapp/channels — create channel
// Body: { business_slug, phone_number_id, phone_display? }
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { business_slug, phone_number_id, phone_display } = await req.json();
  if (!business_slug || !phone_number_id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // Resolve business_id from slug
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("slug", String(business_slug))
    .maybeSingle();

  if (!business) {
    return NextResponse.json({ error: "business_not_found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("whatsapp_channels")
    .insert({
      business_id: business.id,
      business_slug: String(business_slug),
      phone_number_id: String(phone_number_id),
      phone_display: phone_display ? String(phone_display) : null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "phone_number_id_already_exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channel: data }, { status: 201 });
}

// DELETE /api/admin/whatsapp/channels?id=123 — remove channel
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("whatsapp_channels")
    .delete()
    .eq("id", Number(id));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PATCH /api/admin/whatsapp/channels — toggle is_active
// Body: { id, is_active }
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, is_active } = await req.json();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_channels")
    .update({ is_active: Boolean(is_active) })
    .eq("id", Number(id))
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channel: data });
}
