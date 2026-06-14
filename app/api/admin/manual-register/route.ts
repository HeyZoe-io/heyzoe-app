import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { registerMetaPhoneNumberWithPin } from "@/lib/meta-waba-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

/**
 * Admin one-off: POST /{phone_number_id}/register after verify_code succeeded.
 * Body: { phone_number_id: string }
 *
 * Env: WHATSAPP_SYSTEM_TOKEN, WHATSAPP_REGISTRATION_PIN (optional, default 123456).
 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  if (!token) return NextResponse.json({ error: "missing_env" }, { status: 500 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const phone_number_id = String(body?.phone_number_id ?? "").trim();
  if (!phone_number_id) {
    return NextResponse.json({ error: "missing_phone_number_id" }, { status: 400 });
  }

  const reg = await registerMetaPhoneNumberWithPin(phone_number_id, token, {
    logPrefix: "[api/admin/manual-register]",
  });
  if (!reg.ok) {
    return NextResponse.json(
      { error: reg.error ?? "register_failed", status: reg.status, meta: reg.json },
      { status: 502 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: channel, error: chErr } = await admin
    .from("whatsapp_channels")
    .update({ is_active: true, provisioning_status: "active" } as any)
    .eq("phone_number_id", phone_number_id)
    .select("id, business_id, business_slug, phone_display")
    .maybeSingle();

  if (chErr) {
    return NextResponse.json({ error: chErr.message, register: reg.json }, { status: 500 });
  }

  if (channel?.business_slug && channel.phone_display) {
    await admin
      .from("businesses")
      .update({ whatsapp_number: String(channel.phone_display).trim() } as any)
      .eq("slug", String(channel.business_slug).trim().toLowerCase());
  }

  const { data: jobs } = await admin
    .from("wa_provision_jobs")
    .update({ status: "done", updated_at: new Date().toISOString(), last_error: null } as any)
    .eq("meta_phone_number_id", phone_number_id)
    .neq("status", "done")
    .select("id");

  return NextResponse.json({
    ok: true,
    success: true,
    phone_number_id,
    channel_id: channel?.id ?? null,
    jobs_updated: (jobs ?? []).map((r) => Number((r as { id?: unknown }).id)),
    meta: reg.json,
  });
}
