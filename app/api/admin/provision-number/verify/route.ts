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

async function metaVerify(phoneNumberId: string, token: string, code: string) {
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/verify_code`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json && (json.error?.message || json.message)) || text || `meta_verify_failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  if (!token) return NextResponse.json({ error: "missing_env" }, { status: 500 });

  const body = await req.json().catch(() => ({} as any));
  const phone_number_id = String(body?.phone_number_id ?? "").trim();
  const code = String(body?.code ?? "").trim();
  const business_slug = String(body?.business_slug ?? "").trim().toLowerCase();
  const phone_display = body?.phone_display ? String(body.phone_display).trim() : "";
  const twilio_sid = body?.twilio_sid ? String(body.twilio_sid).trim() : "";

  if (!phone_number_id || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  await metaVerify(phone_number_id, token, code);

  const admin = createSupabaseAdminClient();
  const { data: channel, error } = await admin
    .from("whatsapp_channels")
    .update({ is_active: true, provisioning_status: "active", ...(twilio_sid ? { twilio_sid } : {}), ...(phone_display ? { phone_display } : {}) } as any)
    .eq("phone_number_id", phone_number_id)
    .select("id, business_slug, phone_display")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (channel?.business_slug) {
    await admin.from("businesses").update({ whatsapp_number: channel.phone_display } as any).eq("slug", String(channel.business_slug).trim().toLowerCase());
  } else if (business_slug && phone_display) {
    await admin.from("businesses").update({ whatsapp_number: phone_display } as any).eq("slug", business_slug);
  }

  return NextResponse.json({ ok: true });
}

