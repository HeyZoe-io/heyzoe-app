import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Body = {
  business_slug: string;
  mode: "single" | "broadcast";
  phone?: string;
  message: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

async function requireBusinessAccess(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, slug: string) {
  const slugNorm = String(slug ?? "").trim().toLowerCase();
  if (!slugNorm) return { ok: false as const, error: "missing_business_slug" as const };

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, user_id")
    .eq("slug", slugNorm)
    .maybeSingle();

  if (bizErr) return { ok: false as const, error: "business_lookup_failed" as const };
  if (!biz?.id) return { ok: false as const, error: "business_not_found" as const };

  const ownerOk = String(biz.user_id ?? "") === userId;
  if (ownerOk) return { ok: true as const, business: biz as { id: number; slug: string; user_id: string } };

  const { data: membership, error: memErr } = await admin
    .from("business_users")
    .select("business_id")
    .eq("user_id", userId)
    .eq("business_id", biz.id)
    .maybeSingle();

  if (memErr) return { ok: false as const, error: "business_access_check_failed" as const };
  if (!membership) return { ok: false as const, error: "forbidden" as const };

  return { ok: true as const, business: biz as { id: number; slug: string; user_id: string } };
}

function resolveMetaWhatsAppAccessToken(): string {
  return process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ?? process.env.WHATSAPP_CLOUD_API_TOKEN?.trim() ?? "";
}

async function sendMetaWhatsAppText(params: {
  phoneNumberId: string;
  to: string;
  body: string;
  accessToken: string;
}): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(params.phoneNumberId)}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      text: { body: params.body },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`[Meta WA send] ${res.status} ${res.statusText}: ${err}`);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const businessSlug = String(body.business_slug ?? "").trim().toLowerCase();
  const mode = body.mode === "broadcast" ? "broadcast" : body.mode === "single" ? "single" : null;
  const phone = String(body.phone ?? "").trim();
  const msg = String(body.message ?? "").trim();

  if (!businessSlug) return NextResponse.json({ error: "missing_business_slug" }, { status: 400 });
  if (!mode) return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  if (!msg) return NextResponse.json({ error: "missing_message" }, { status: 400 });
  if (mode === "single" && !phone) return NextResponse.json({ error: "missing_phone" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const access = await requireBusinessAccess(admin, user.id, businessSlug);
  if (!access.ok) {
    const status = access.error === "forbidden" ? 403 : access.error === "business_not_found" ? 404 : 400;
    return NextResponse.json({ error: access.error }, { status });
  }

  const businessId = access.business.id;

  const metaToken = resolveMetaWhatsAppAccessToken();
  if (!metaToken) {
    return NextResponse.json({ error: "missing_meta_whatsapp_token" }, { status: 500 });
  }

  const { data: channel } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id, is_active")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .maybeSingle();

  const phoneNumberId = String((channel as any)?.phone_number_id ?? "").trim();
  if (!phoneNumberId) {
    return NextResponse.json({ error: "no_active_whatsapp_channel" }, { status: 400 });
  }

  const footer = "\n\n_לביטול קבלת הודעות שלח *הסר*_";
  const finalMessage = `${msg}${footer}`;
  const nowIso = new Date().toISOString();

  let sent = 0;
  let failed = 0;

  if (mode === "single") {
    try {
      await sendMetaWhatsAppText({ phoneNumberId, to: phone, body: finalMessage, accessToken: metaToken });
      sent += 1;
      await admin
        .from("contacts")
        .update({ last_contact_at: nowIso })
        .eq("business_id", businessId)
        .eq("phone", phone);
    } catch (e) {
      console.error("[api/contacts/send] single send failed:", e);
      failed += 1;
    }

    return NextResponse.json({ sent, failed });
  }

  // Broadcast
  const { data: contacts, error: contactsErr } = await admin
    .from("contacts")
    .select("phone")
    .eq("business_id", businessId)
    .eq("opted_out", false);

  if (contactsErr) {
    console.error("[api/contacts/send] contacts fetch failed:", contactsErr);
    return NextResponse.json({ error: "contacts_fetch_failed" }, { status: 500 });
  }

  for (const c of contacts ?? []) {
    const to = String((c as any)?.phone ?? "").trim();
    if (!to) continue;
    try {
      await sendMetaWhatsAppText({ phoneNumberId, to, body: finalMessage, accessToken: metaToken });
      sent += 1;
      await admin.from("contacts").update({ last_contact_at: nowIso }).eq("business_id", businessId).eq("phone", to);
    } catch (e) {
      console.error("[api/contacts/send] broadcast send failed:", { to, e });
      failed += 1;
    }
    await sleep(500);
  }

  return NextResponse.json({ sent, failed });
}

