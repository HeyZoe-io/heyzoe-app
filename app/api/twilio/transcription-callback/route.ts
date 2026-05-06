import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function isoNow() {
  return new Date().toISOString();
}

function normalizeE164(s: string) {
  return String(s ?? "").trim().replace(/\s+/g, "");
}

function extract6DigitCode(s: string) {
  const m = String(s ?? "").match(/\b\d{6}\b/);
  return m?.[0] ?? "";
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

function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  try {
    const { createHmac, timingSafeEqual } = require("crypto") as typeof import("crypto");
    const keys = Object.keys(params).sort();
    const strToSign = url + keys.map((k) => k + (params[k] ?? "")).join("");
    const computed = createHmac("sha1", authToken).update(strToSign, "utf8").digest("base64");
    const a = Buffer.from(computed);
    const b = Buffer.from(String(signature ?? ""));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const whatsappSystemToken = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  const signature = req.headers.get("x-twilio-signature") ?? "";

  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw).entries());

  if (twilioAuthToken) {
    // Twilio signs the exact URL (scheme/host/path) used to reach this function.
    const signingUrl = req.nextUrl.toString();
    if (!verifyTwilioSignature(twilioAuthToken, signature, signingUrl, params)) {
      console.warn("[twilio/transcription-callback] invalid signature");
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const recordingSid = String(params.RecordingSid ?? "").trim();
  const transcriptionSid = String(params.TranscriptionSid ?? "").trim();
  const callSid = String(params.CallSid ?? "").trim();
  const status = String(params.TranscriptionStatus ?? params.TranscriptionStatusCallbackEvent ?? "").trim();
  const text = String(params.TranscriptionText ?? "").trim();
  const toE164 = normalizeE164(String(params.To ?? params.Called ?? "").trim());

  console.info("[twilio/transcription-callback]", {
    recordingSid: recordingSid || null,
    transcriptionSid: transcriptionSid || null,
    callSid: callSid || null,
    status: status || null,
    hasText: Boolean(text),
  });

  if (!recordingSid) return NextResponse.json({ ok: true, ignored: "missing_recording_sid" });
  if (!text) return NextResponse.json({ ok: true, ignored: "missing_text" });

  const code = extract6DigitCode(text);
  if (!code) return NextResponse.json({ ok: true, ignored: "no_6_digit_code" });
  if (!whatsappSystemToken) return NextResponse.json({ ok: false, error: "missing_env_whatsapp_system_token" }, { status: 500 });

  const admin = createSupabaseAdminClient();

  // Find the latest in-flight job by recording_sid and/or the Twilio "To" number.
  const statuses = ["running", "waiting_recording", "transcribing", "awaiting_manual_code"] as const;
  const orParts: string[] = [];
  if (recordingSid) orParts.push(`recording_sid.eq.${recordingSid}`);
  if (toE164) orParts.push(`phone_e164.eq.${toE164}`);

  const q = admin
    .from("wa_provision_jobs")
    .select("id,business_id,phone_e164,meta_phone_number_id,twilio_sid,recording_sid,status")
    .in("status", statuses as any)
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: job } =
    orParts.length >= 2
      ? await q.or(orParts.join(",")).maybeSingle()
      : orParts.length === 1
        ? await q.or(orParts[0]!).maybeSingle()
        : await q.maybeSingle();

  if (!job?.id) {
    console.warn("[twilio/transcription-callback] no matching wa_provision_job", {
      recordingSid,
      toE164: toE164 || null,
    });
    return NextResponse.json({ ok: true, ignored: "no_matching_job" });
  }

  const metaPhoneNumberId = String((job as any).meta_phone_number_id ?? "").trim();
  const phoneE164 = normalizeE164(String((job as any).phone_e164 ?? toE164 ?? "").trim());
  if (!metaPhoneNumberId) {
    await admin
      .from("wa_provision_jobs")
      .update({ updated_at: isoNow(), recording_sid: recordingSid, last_error: "callback_missing_meta_phone_number_id" } as any)
      .eq("id", Number(job.id));
    return NextResponse.json({ ok: true, ignored: "missing_meta_phone_number_id" });
  }

  // Persist recordingSid if not stored yet (or if it changed).
  if (String((job as any).recording_sid ?? "").trim() !== recordingSid) {
    await admin
      .from("wa_provision_jobs")
      .update({ updated_at: isoNow(), recording_sid: recordingSid } as any)
      .eq("id", Number(job.id));
  }

  // Verify in Meta immediately.
  const verifyUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/verify_code`;
  try {
    await metaFetchJson(verifyUrl, whatsappSystemToken, { code });
  } catch (e: any) {
    const msg = String(e?.message ?? "verify_code_failed");
    await admin
      .from("wa_provision_jobs")
      .update({
        status: "awaiting_manual_code",
        updated_at: isoNow(),
        last_error: `callback_verify_failed:${msg}`.slice(0, 280),
        recording_sid: recordingSid,
      } as any)
      .eq("id", Number(job.id));
    return NextResponse.json({ ok: true, verified: false, error: "meta_verify_failed" });
  }

  // Save active + finalize job.
  await admin
    .from("whatsapp_channels")
    .update({ is_active: true, provisioning_status: "active" } as any)
    .eq("phone_number_id", metaPhoneNumberId);

  if (phoneE164) {
    await admin
      .from("businesses")
      .update({ whatsapp_number: phoneE164 } as any)
      .eq("id", (job as any).business_id);
  }

  await admin
    .from("wa_provision_jobs")
    .update({
      status: "done",
      updated_at: isoNow(),
      phone_e164: phoneE164 || null,
      meta_phone_number_id: metaPhoneNumberId,
      recording_sid: recordingSid,
      last_error: null,
    } as any)
    .eq("id", Number(job.id));

  return NextResponse.json({ ok: true, verified: true, job_id: Number(job.id) });
}

