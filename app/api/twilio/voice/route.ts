import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10;

function twiml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

export async function GET() {
  const xml = twiml(
    `<Record transcribe="true" transcribeCallback="https://heyzoe.io/api/twilio/transcription-callback" maxLength="30" timeout="5" playBeep="false" />`
  );
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

export async function POST() {
  // Twilio may request TwiML via POST as well.
  return GET();
}

