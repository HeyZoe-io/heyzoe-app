import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { logMessage } from "@/lib/analytics";
import { formatManualMediaMessageContent, isAllowedManualMediaUrl } from "@/lib/conversation-manual-media";
import {
  isMetaCloudPhoneNumberId,
  resolveMetaAccessToken,
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
  sendWhatsAppMediaMessage,
  sendWhatsAppMessage,
} from "@/lib/whatsapp";
import { extractPhoneFromSessionId } from "@/lib/conversations-sessions";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

function parseSession(sessionId: string) {
  // Format: wa_{phone_number_id}_{leadPhone}
  if (!sessionId.startsWith("wa_")) return null;
  const rest = sessionId.slice(3);
  const firstUnderscore = rest.indexOf("_");
  if (firstUnderscore < 0) return null;
  const phoneNumberId = rest.slice(0, firstUnderscore);
  const leadPhone = extractPhoneFromSessionId(sessionId) || rest.slice(firstUnderscore + 1);
  if (!phoneNumberId || !leadPhone) return null;
  return { phoneNumberId, leadPhone };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const businessSlug = typeof body.business_slug === "string" ? body.business_slug.trim() : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const mediaUrl = typeof body.media_url === "string" ? body.media_url.trim() : "";

    if (!businessSlug || !sessionId || (!text && !mediaUrl)) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    if (mediaUrl && !isAllowedManualMediaUrl(mediaUrl)) {
      return NextResponse.json({ error: "invalid_media_url" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const access = await assertBusinessAccess(admin, { id: user.id, email: user.email }, businessSlug);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = parseSession(sessionId);
    if (!parsed) {
      return NextResponse.json({ error: "invalid_session_format" }, { status: 400 });
    }

    const accountSid = resolveTwilioAccountSid();
    const authToken = resolveTwilioAuthToken();
    const metaSend =
      isMetaCloudPhoneNumberId(parsed.phoneNumberId) && Boolean(resolveMetaAccessToken());
    if (!metaSend && (!accountSid || !authToken)) {
      return NextResponse.json({ error: "missing_twilio_credentials" }, { status: 500 });
    }

    if (mediaUrl) {
      await sendWhatsAppMediaMessage(
        parsed.phoneNumberId,
        parsed.leadPhone,
        mediaUrl,
        accountSid ?? "",
        authToken ?? "",
        text || undefined,
        "image"
      );
    } else {
      await sendWhatsAppMessage(
        parsed.phoneNumberId,
        parsed.leadPhone,
        text,
        accountSid ?? "",
        authToken ?? ""
      );
    }

    const loggedContent = mediaUrl
      ? formatManualMediaMessageContent(mediaUrl, text)
      : text;

    // Log assistant-style message
    await logMessage({
      business_slug: businessSlug,
      role: "assistant",
      content: loggedContent,
      model_used: "manual_handoff",
      session_id: sessionId,
      error_code: null,
    });

    return NextResponse.json({ ok: true, content: loggedContent });
  } catch (e) {
    console.error("[api/whatsapp/manual-send] failed:", e);
    return NextResponse.json({ error: "manual_send_failed" }, { status: 500 });
  }
}

