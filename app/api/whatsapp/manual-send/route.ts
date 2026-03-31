import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage } from "@/lib/analytics";
import { resolveTwilioAccountSid, resolveTwilioAuthToken, sendWhatsAppMessage } from "@/lib/whatsapp";

export const runtime = "nodejs";

function parseSession(sessionId: string) {
  // Format: wa_{toNumber}_{fromNumber}
  if (!sessionId.startsWith("wa_")) return null;
  const rest = sessionId.slice(3);
  const firstUnderscore = rest.indexOf("_");
  if (firstUnderscore < 0) return null;
  const toNumber = rest.slice(0, firstUnderscore);
  const fromNumber = rest.slice(firstUnderscore + 1);
  if (!toNumber || !fromNumber) return null;
  return { toNumber, fromNumber };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessSlug = typeof body.business_slug === "string" ? body.business_slug.trim() : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!businessSlug || !sessionId || !text) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const parsed = parseSession(sessionId);
    if (!parsed) {
      return NextResponse.json({ error: "invalid_session_format" }, { status: 400 });
    }

    const accountSid = resolveTwilioAccountSid();
    const authToken = resolveTwilioAuthToken();
    if (!accountSid || !authToken) {
      return NextResponse.json({ error: "missing_twilio_credentials" }, { status: 500 });
    }

    // Send manual WhatsApp message via Twilio
    await sendWhatsAppMessage(parsed.toNumber, parsed.fromNumber, text, accountSid, authToken);

    // Log assistant-style message
    await logMessage({
      business_slug: businessSlug,
      role: "assistant",
      content: text,
      model_used: "manual_handoff",
      session_id: sessionId,
      error_code: null,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/whatsapp/manual-send] failed:", e);
    return NextResponse.json({ error: "manual_send_failed" }, { status: 500 });
  }
}

