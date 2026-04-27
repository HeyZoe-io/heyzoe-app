import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
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

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const whatsappSystemToken = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";

  if (!twilioAccountSid || !twilioAuthToken || !whatsappSystemToken) {
    return NextResponse.json({ error: "missing_env" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({} as any));
  const business_slug = String(body?.business_slug ?? "").trim().toLowerCase();
  const verified_name = String(body?.verified_name ?? "").trim();
  if (!business_slug || !verified_name) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const twilioAuth = twilioAuthHeader(twilioAccountSid, twilioAuthToken);
  const twimlVoiceUrl = "https://handler.twilio.com/twiml/EH3a2831d7f10a000887d9678027077ad9";
  const metaBusinessId = "414529741736731";

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (data: unknown) => controller.enqueue(enc.encode(sse(data)));

      let purchased: { twilioSid: string; phoneE164: string } | null = null;
      let metaPhoneNumberId = "";

      try {
        write({ type: "step", step: "searching" });
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

        write({ type: "step", step: "purchasing" });
        const buyUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/IncomingPhoneNumbers.json`;
        const buy = await twilioFetchJson(buyUrl, {
          method: "POST",
          headers: { Authorization: twilioAuth },
          body: new URLSearchParams({ PhoneNumber: phone_number }),
        });
        purchased = { twilioSid: String(buy?.sid ?? "").trim(), phoneE164: String(buy?.phone_number ?? phone_number).trim() };
        if (!purchased.twilioSid) throw new Error("twilio_purchase_missing_sid");

        write({ type: "step", step: "twiml" });
        const updateUrl =
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
          `/IncomingPhoneNumbers/${encodeURIComponent(purchased.twilioSid)}.json`;
        await twilioFetchJson(updateUrl, {
          method: "POST",
          headers: { Authorization: twilioAuth },
          body: new URLSearchParams({ VoiceUrl: twimlVoiceUrl }),
        });

        write({ type: "step", step: "meta_register" });
        const metaRegUrl = `https://graph.facebook.com/v21.0/${metaBusinessId}/phone_numbers`;
        const metaReg = await metaFetchJson(metaRegUrl, whatsappSystemToken, {
          cc: "972",
          phone_number: stripCc972(purchased.phoneE164),
          verified_name,
        });
        metaPhoneNumberId = String(metaReg?.id ?? metaReg?.phone_number_id ?? "").trim();
        if (!metaPhoneNumberId) throw new Error("meta_register_missing_id");

        write({ type: "step", step: "meta_request_code" });
        const metaRequestCodeUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/request_code`;
        await metaFetchJson(metaRequestCodeUrl, whatsappSystemToken, { method: "VOICE" });

        write({ type: "step", step: "waiting_recording" });
        await sleep(30_000);

        const recordingsUrl =
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
          `/Recordings.json?To=${encodeURIComponent(purchased.phoneE164)}&PageSize=1`;
        const rec = await twilioFetchJson(recordingsUrl, { headers: { Authorization: twilioAuth }, body: null });
        const rec0 = Array.isArray(rec?.recordings) ? rec.recordings[0] : null;
        const recordingSid = String(rec0?.sid ?? "").trim();

        if (!recordingSid) {
          write({
            type: "result",
            status: "awaiting_manual_code",
            phone: purchased.phoneE164,
            phone_number_id: metaPhoneNumberId,
            twilio_sid: purchased.twilioSid,
          });
          controller.close();
          return;
        }

        write({ type: "step", step: "transcribing" });
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
        if (!code) {
          write({
            type: "result",
            status: "awaiting_manual_code",
            phone: purchased.phoneE164,
            phone_number_id: metaPhoneNumberId,
            twilio_sid: purchased.twilioSid,
          });
          controller.close();
          return;
        }

        write({ type: "step", step: "verifying" });
        const verifyUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/verify_code`;
        await metaFetchJson(verifyUrl, whatsappSystemToken, { code });

        write({ type: "step", step: "saving" });
        const admin = createSupabaseAdminClient();
        const { data: business } = await admin.from("businesses").select("id").eq("slug", business_slug).maybeSingle();
        if (!business?.id) throw new Error("business_not_found");

        const phone_display = purchased.phoneE164;
        const upsert = await admin
          .from("whatsapp_channels")
          .upsert(
            {
              business_id: business.id,
              business_slug,
              phone_number_id: metaPhoneNumberId,
              phone_display,
              is_active: true,
              twilio_sid: purchased.twilioSid,
              provisioning_status: "active",
            } as any,
            { onConflict: "phone_number_id" }
          )
          .select()
          .maybeSingle();
        if (upsert.error) throw new Error(upsert.error.message);

        const updBiz = await admin.from("businesses").update({ whatsapp_number: phone_display } as any).eq("id", business.id);
        if (updBiz.error) throw new Error(updBiz.error.message);

        write({
          type: "result",
          status: "ok",
          phone: purchased.phoneE164,
          phone_number_id: metaPhoneNumberId,
          twilio_sid: purchased.twilioSid,
        });
        controller.close();
      } catch (e) {
        try {
          if (purchased?.phoneE164 && metaPhoneNumberId) {
            const admin = createSupabaseAdminClient();
            const { data: business } = await admin.from("businesses").select("id").eq("slug", business_slug).maybeSingle();
            if (business?.id) {
              await admin
                .from("whatsapp_channels")
                .upsert(
                  {
                    business_id: business.id,
                    business_slug,
                    phone_number_id: metaPhoneNumberId,
                    phone_display: purchased.phoneE164,
                    is_active: false,
                    twilio_sid: purchased.twilioSid,
                    provisioning_status: "failed",
                  } as any,
                  { onConflict: "phone_number_id" }
                );
            }
          }
        } catch {
          // ignore
        }
        const msg = e instanceof Error ? e.message : String(e);
        write({ type: "result", status: "error", error: msg, phone: purchased?.phoneE164 || undefined, phone_number_id: metaPhoneNumberId || undefined, twilio_sid: purchased?.twilioSid || undefined });
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

