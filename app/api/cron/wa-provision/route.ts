import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { sendEmail, whatsappReadyEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/wa-provision] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function twilioAuthHeader(accountSid: string, authToken: string) {
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  return `Basic ${basic}`;
}

function normalizeE164(s: string) {
  return String(s ?? "").trim().replace(/\s+/g, "");
}

function isIlTelAvivLandline(e164: string): boolean {
  const n = normalizeE164(e164);
  return n.startsWith("+9723") || n.startsWith("+972-3") || n.startsWith("+972 3");
}

function parseMonthlyUsd(row: any): number | null {
  const direct =
    typeof row?.monthly_cost === "number"
      ? row.monthly_cost
      : typeof row?.price === "number"
        ? row.price
        : typeof row?.cost === "number"
          ? row.cost
          : null;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const s = String(row?.monthly_cost ?? row?.price ?? row?.cost ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function twilioFetchJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: URLSearchParams | null }
) {
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

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const whatsappSystemToken = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  if (!twilioAccountSid || !twilioAuthToken || !whatsappSystemToken) {
    return NextResponse.json({ error: "missing_env" }, { status: 500 });
  }

  const admin = createSupabaseAdminClient();

  // Pick one queued job
  const { data: job } = await admin
    .from("wa_provision_jobs")
    .select("id, business_id, business_slug, business_name, attempts")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!job?.id) return NextResponse.json({ ok: true, processed: 0 });

  // Lock it optimistically
  const { data: locked } = await admin
    .from("wa_provision_jobs")
    .update({
      status: "running",
      attempts: Number((job as any).attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", Number(job.id))
    .eq("status", "queued")
    .select("id, business_id, business_slug, business_name, attempts")
    .maybeSingle();

  if (!locked?.id) return NextResponse.json({ ok: true, processed: 0, raced: true });

  const twilioAuth = twilioAuthHeader(twilioAccountSid, twilioAuthToken);
  const twimlVoiceUrl = "https://handler.twilio.com/twiml/EH3a2831d7f10a000887d9678027077ad9";
  const metaBusinessId = "414529741736731";

  let phoneE164 = "";
  let twilioSid = "";
  let metaPhoneNumberId = "";

  try {
    // Step 1: search + purchase
    const availableUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
      "/AvailablePhoneNumbers/IL/Local.json?VoiceEnabled=true&ExcludeAllAddressRequired=true&ExcludeLocalAddressRequired=true&ExcludeForeignAddressRequired=true&Beta=false&Contains=%2B9723*&PageSize=20";
    const avail = await twilioFetchJson(availableUrl, { headers: { Authorization: twilioAuth }, body: null });
    const list = Array.isArray(avail?.available_phone_numbers) ? avail.available_phone_numbers : [];
    const picked =
      list.find((r: any) => isIlTelAvivLandline(String(r?.phone_number ?? "")) && ((parseMonthlyUsd(r) ?? 0) <= 10 && (parseMonthlyUsd(r) ?? 0) > 0)) ||
      list.find((r: any) => isIlTelAvivLandline(String(r?.phone_number ?? ""))) ||
      null;
    const phone_number = String(picked?.phone_number ?? "").trim();
    if (!phone_number) throw new Error("no_available_numbers");

    const buyUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/IncomingPhoneNumbers.json`;
    const buy = await twilioFetchJson(buyUrl, {
      method: "POST",
      headers: { Authorization: twilioAuth },
      body: new URLSearchParams({ PhoneNumber: phone_number }),
    });
    twilioSid = String(buy?.sid ?? "").trim();
    phoneE164 = String(buy?.phone_number ?? phone_number).trim();
    if (!twilioSid) throw new Error("twilio_purchase_missing_sid");

    // Step 2: TwiML
    const updateUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
      `/IncomingPhoneNumbers/${encodeURIComponent(twilioSid)}.json`;
    await twilioFetchJson(updateUrl, {
      method: "POST",
      headers: { Authorization: twilioAuth },
      body: new URLSearchParams({ VoiceUrl: twimlVoiceUrl }),
    });

    // Step 3: Meta register + request voice code
    const metaRegUrl = `https://graph.facebook.com/v21.0/${metaBusinessId}/phone_numbers`;
    const metaReg = await metaFetchJson(metaRegUrl, whatsappSystemToken, {
      cc: "972",
      phone_number: stripCc972(phoneE164),
      verified_name: String((locked as any).business_name ?? "").trim() || String((locked as any).business_slug ?? ""),
    });
    metaPhoneNumberId = String(metaReg?.id ?? metaReg?.phone_number_id ?? "").trim();
    if (!metaPhoneNumberId) throw new Error("meta_register_missing_id");

    // Persist pending channel as soon as we have Meta ID
    await admin
      .from("whatsapp_channels")
      .upsert(
        {
          business_id: (locked as any).business_id,
          business_slug: String((locked as any).business_slug ?? "").trim().toLowerCase(),
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

    // Step 4: wait + recording + transcription
    await sleep(30_000);
    const recordingsUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
      `/Recordings.json?To=${encodeURIComponent(phoneE164)}&PageSize=1`;
    const rec = await twilioFetchJson(recordingsUrl, { headers: { Authorization: twilioAuth }, body: null });
    const rec0 = Array.isArray(rec?.recordings) ? rec.recordings[0] : null;
    const recordingSid = String(rec0?.sid ?? "").trim();

    if (!recordingSid) {
      await admin
        .from("wa_provision_jobs")
        .update({
          status: "awaiting_manual_code",
          updated_at: new Date().toISOString(),
          phone_e164: phoneE164,
          meta_phone_number_id: metaPhoneNumberId,
          twilio_sid: twilioSid,
        } as any)
        .eq("id", Number(locked.id));
      return NextResponse.json({ ok: true, processed: 1, status: "awaiting_manual_code" });
    }

    const startTxUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
      `/Recordings/${encodeURIComponent(recordingSid)}/Transcriptions.json`;
    await twilioFetchJson(startTxUrl, {
      method: "POST",
      headers: { Authorization: twilioAuth },
      body: new URLSearchParams(),
    });

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
    if (!code) {
      await admin
        .from("wa_provision_jobs")
        .update({
          status: "awaiting_manual_code",
          updated_at: new Date().toISOString(),
          phone_e164: phoneE164,
          meta_phone_number_id: metaPhoneNumberId,
          twilio_sid: twilioSid,
        } as any)
        .eq("id", Number(locked.id));
      return NextResponse.json({ ok: true, processed: 1, status: "awaiting_manual_code" });
    }

    // Step 5: verify
    const verifyUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/verify_code`;
    await metaFetchJson(verifyUrl, whatsappSystemToken, { code });

    // Step 6: save active
    await admin
      .from("whatsapp_channels")
      .update({ is_active: true, provisioning_status: "active" } as any)
      .eq("phone_number_id", metaPhoneNumberId);

    await admin
      .from("businesses")
      .update({ whatsapp_number: phoneE164 } as any)
      .eq("id", (locked as any).business_id);

    // Email customer (best-effort) - whatsappReadyEmail
    try {
      const { data: biz } = await admin
        .from("businesses")
        .select("name,email,slug,whatsapp_number")
        .eq("id", (locked as any).business_id)
        .maybeSingle();
      const to = String((biz as any)?.email ?? "").trim().toLowerCase();
      const businessName = String((biz as any)?.name ?? (locked as any)?.business_name ?? "").trim() || String((locked as any).business_slug ?? "");
      const whatsappNumber = String((biz as any)?.whatsapp_number ?? phoneE164 ?? "").trim();
      if (to) {
        const tpl = whatsappReadyEmail(businessName, whatsappNumber);
        await sendEmail({
          to,
          subject: tpl.subject,
          htmlContent: tpl.htmlContent,
        });
      }
    } catch (e) {
      console.error("[cron/wa-provision] customer email failed:", e);
    }

    await admin
      .from("wa_provision_jobs")
      .update({
        status: "done",
        updated_at: new Date().toISOString(),
        phone_e164: phoneE164,
        meta_phone_number_id: metaPhoneNumberId,
        twilio_sid: twilioSid,
      } as any)
      .eq("id", Number(locked.id));

    return NextResponse.json({ ok: true, processed: 1, status: "done", phone: phoneE164 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Best-effort persist failure state
    if (metaPhoneNumberId) {
      await admin
        .from("whatsapp_channels")
        .upsert(
          {
            business_id: (locked as any).business_id,
            business_slug: String((locked as any).business_slug ?? "").trim().toLowerCase(),
            phone_number_id: metaPhoneNumberId,
            phone_display: phoneE164 || null,
            is_active: false,
            twilio_sid: twilioSid || null,
            provisioning_status: "failed",
          } as any,
          { onConflict: "phone_number_id" }
        );
    }

    await admin
      .from("wa_provision_jobs")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
        last_error: msg,
        phone_e164: phoneE164 || null,
        meta_phone_number_id: metaPhoneNumberId || null,
        twilio_sid: twilioSid || null,
      } as any)
      .eq("id", Number(locked.id));

    // Email business on failure (best-effort)
    try {
      const { data: biz } = await admin
        .from("businesses")
        .select("name,slug,email")
        .eq("id", (locked as any).business_id)
        .maybeSingle();
      const businessName = String((biz as any)?.name ?? (locked as any)?.business_name ?? "").trim() || String((locked as any).business_slug ?? "");
      const slug = String((biz as any)?.slug ?? (locked as any)?.business_slug ?? "").trim().toLowerCase();
      const to = String((biz as any)?.email ?? "").trim().toLowerCase();
      if (to) {
        await sendEmail({
          to,
          subject: `⚠️ פרוויז'ן נכשל - ${businessName}`,
          htmlContent: [
            `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif">`,
            `<p><b>פרוויז'ן נכשל</b></p>`,
            `<p><b>עסק:</b> ${businessName}</p>`,
            `<p><b>slug:</b> ${slug}</p>`,
            `<p><b>שגיאה:</b> ${String(msg).replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`,
            `<p><b>Twilio SID:</b> ${twilioSid || "-"}</p>`,
            `<p><b>Meta phone_number_id:</b> ${metaPhoneNumberId || "-"}</p>`,
            `<p><b>Phone:</b> ${phoneE164 || "-"}</p>`,
            `</div>`,
          ].join(""),
        });
      }
    } catch (err) {
      console.error("[cron/wa-provision] failure email failed:", err);
    }

    return NextResponse.json({ ok: true, processed: 1, status: "failed" });
  }
}

