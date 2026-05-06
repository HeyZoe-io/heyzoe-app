import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10;

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

  console.info("[twilio/transcription-callback]", {
    recordingSid: recordingSid || null,
    transcriptionSid: transcriptionSid || null,
    callSid: callSid || null,
    status: status || null,
    hasText: Boolean(text),
  });

  return NextResponse.json({ ok: true });
}

