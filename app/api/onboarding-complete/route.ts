import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function twilioAuthHeader(accountSid: string, authToken: string) {
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  return `Basic ${basic}`;
}

async function twilioFetchJson(url: string, opts: { method?: string; headers?: Record<string, string>; body?: URLSearchParams | null }) {
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      ...(opts.headers || {}),
      ...(opts.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: opts.body ? opts.body.toString() : undefined,
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json && (json.message || json.error_message)) || text || `twilio_failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function metaFetchJson(url: string, token: string, body: Record<string, any>) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json && (json.error?.message || json.message)) || text || `meta_failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

function stripCc972(e164: string) {
  const clean = String(e164 || "").trim().replace(/\s+/g, "");
  if (clean.startsWith("+972")) return clean.slice(4);
  if (clean.startsWith("972")) return clean.slice(3);
  return clean.replace(/^\+/, "");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function autoProvisionWhatsAppNumber(admin: ReturnType<typeof createSupabaseAdminClient>, args: { businessId: number; businessSlug: string; businessName: string }) {
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const whatsappSystemToken = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  if (!twilioAccountSid || !twilioAuthToken || !whatsappSystemToken) return;

  const twilioAuth = twilioAuthHeader(twilioAccountSid, twilioAuthToken);
  const twimlVoiceUrl = "https://handler.twilio.com/twiml/EH3a2831d7f10a000887d9678027077ad9";
  const metaBusinessId = "414529741736731";

  const availableUrl =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
    "/AvailablePhoneNumbers/IL/Local.json?VoiceEnabled=true&ExcludeAllAddressRequired=true&ExcludeLocalAddressRequired=true&ExcludeForeignAddressRequired=true&Beta=false&PageSize=5";
  const avail = await twilioFetchJson(availableUrl, { headers: { Authorization: twilioAuth }, body: null });
  const first = Array.isArray(avail?.available_phone_numbers) ? avail.available_phone_numbers[0] : null;
  const phone_number = String(first?.phone_number ?? "").trim();
  if (!phone_number) throw new Error("no_available_numbers");

  const buyUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/IncomingPhoneNumbers.json`;
  const buy = await twilioFetchJson(buyUrl, {
    method: "POST",
    headers: { Authorization: twilioAuth },
    body: new URLSearchParams({ PhoneNumber: phone_number }),
  });
  const twilioSid = String(buy?.sid ?? "").trim();
  const phoneE164 = String(buy?.phone_number ?? phone_number).trim();
  if (!twilioSid) throw new Error("twilio_purchase_missing_sid");

  const updateUrl =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
    `/IncomingPhoneNumbers/${encodeURIComponent(twilioSid)}.json`;
  await twilioFetchJson(updateUrl, {
    method: "POST",
    headers: { Authorization: twilioAuth },
    body: new URLSearchParams({ VoiceUrl: twimlVoiceUrl }),
  });

  const metaRegUrl = `https://graph.facebook.com/v21.0/${metaBusinessId}/phone_numbers`;
  const metaReg = await metaFetchJson(metaRegUrl, whatsappSystemToken, {
    cc: "972",
    phone_number: stripCc972(phoneE164),
    verified_name: args.businessName,
  });
  const metaPhoneNumberId = String(metaReg?.id ?? metaReg?.phone_number_id ?? "").trim();
  if (!metaPhoneNumberId) throw new Error("meta_register_missing_id");

  await admin
    .from("whatsapp_channels")
    .upsert(
      {
        business_id: args.businessId,
        business_slug: args.businessSlug,
        phone_number_id: metaPhoneNumberId,
        phone_display: phoneE164,
        is_active: false,
        twilio_sid: twilioSid,
        provisioning_status: "pending",
      } as any,
      { onConflict: "phone_number_id" }
    );

  const metaRequestCodeUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/request_code`;
  await metaFetchJson(metaRequestCodeUrl, whatsappSystemToken, { method: "VOICE" });

  await sleep(30_000);
  const recordingsUrl =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
    `/Recordings.json?To=${encodeURIComponent(phoneE164)}&PageSize=1`;
  const rec = await twilioFetchJson(recordingsUrl, { headers: { Authorization: twilioAuth }, body: null });
  const rec0 = Array.isArray(rec?.recordings) ? rec.recordings[0] : null;
  const recordingSid = String(rec0?.sid ?? "").trim();
  if (!recordingSid) return;

  const startTxUrl =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
    `/Recordings/${encodeURIComponent(recordingSid)}/Transcriptions.json`;
  await twilioFetchJson(startTxUrl, { method: "POST", headers: { Authorization: twilioAuth }, body: new URLSearchParams() });

  const deadline = Date.now() + 20_000;
  let transcript = "";
  while (Date.now() < deadline) {
    await sleep(2_000);
    const listTxUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
      `/Recordings/${encodeURIComponent(recordingSid)}/Transcriptions.json`;
    const txList = await twilioFetchJson(listTxUrl, { headers: { Authorization: twilioAuth }, body: null });
    const t0 = Array.isArray(txList?.transcriptions) ? txList.transcriptions[0] : null;
    const text = String(t0?.transcription_text ?? "").trim();
    if (text) {
      transcript = text;
      break;
    }
  }

  const match = transcript.match(/\b\d{6}\b/);
  const code = match ? match[0] : "";
  if (!code) return;

  const verifyUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/verify_code`;
  await metaFetchJson(verifyUrl, whatsappSystemToken, { code });

  await admin
    .from("whatsapp_channels")
    .update({ is_active: true, provisioning_status: "active" } as any)
    .eq("phone_number_id", metaPhoneNumberId);

  await admin.from("businesses").update({ whatsapp_number: phoneE164 } as any).eq("id", args.businessId);
}

function toSlugBase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueSlug(admin: ReturnType<typeof createSupabaseAdminClient>, base: string) {
  const cleanBase = base || "business";
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? cleanBase : `${cleanBase}-${i + 1}`;
    const { data } = await admin.from("businesses").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${cleanBase}-${Date.now().toString(36)}`;
}

async function ensurePrimaryBusinessUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  userId: string
) {
  const { error } = await admin.from("business_users").upsert(
    {
      business_id: businessId,
      user_id: userId,
      role: "admin",
      status: "active",
      is_primary: true,
    },
    { onConflict: "business_id,user_id" } as any
  );
  if (error) throw error;
}

export async function POST(req: NextRequest) {
  try {
    const {
      first_name,
      last_name,
      phone,
      email,
      password,
      studio_name,
      business_type,
      description,
      address,
      plan,
    } = (await req.json()) as {
      first_name?: string;
      last_name?: string;
      phone?: string;
      email?: string;
      password?: string;
      studio_name?: string;
      business_type?: string;
      description?: string;
      address?: string;
      plan?: "starter" | "pro";
    };

    if (!email?.trim() || !studio_name?.trim() || !password || password.length < 8) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const slug = await ensureUniqueSlug(admin, toSlugBase(studio_name));

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email.trim(),
      phone: phone?.trim() || undefined,
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: first_name?.trim() || "",
        last_name: last_name?.trim() || "",
      },
    });

    if (authError || !authData.user) throw authError ?? new Error("user_create_failed");

    const { data: insertedBiz, error: bizError } = await admin
      .from("businesses")
      .insert({
        user_id: authData.user.id,
        slug,
        name: studio_name.trim(),
        niche: business_type?.trim() || "",
        bot_name: "זואי",
        social_links: {
          address: address?.trim() || "",
          business_description: description?.trim() || "",
        },
        plan: plan === "pro" ? "premium" : "basic",
      } as any)
      .select("id, slug")
      .single();

    if (bizError || !insertedBiz) throw bizError ?? new Error("business_create_failed");

    await ensurePrimaryBusinessUser(admin, Number(insertedBiz.id), authData.user.id);

    try {
      await autoProvisionWhatsAppNumber(admin, {
        businessId: Number(insertedBiz.id),
        businessSlug: String(insertedBiz.slug),
        businessName: studio_name.trim(),
      });
    } catch (e) {
      console.error("[api/onboarding-complete] autoProvisionWhatsAppNumber failed:", e);
    }

    return NextResponse.json({ success: true, slug: insertedBiz.slug });
  } catch (error) {
    console.error("[api/onboarding-complete] error:", error);
    return NextResponse.json({ error: "שגיאה בשמירת פרטים" }, { status: 500 });
  }
}

