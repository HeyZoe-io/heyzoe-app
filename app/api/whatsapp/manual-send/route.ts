import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { logMessage } from "@/lib/analytics";
import { resolveTwilioAccountSid, resolveTwilioAuthToken, sendWhatsAppMessage } from "@/lib/whatsapp";

export const runtime = "nodejs";

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
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const businessSlug = typeof body.business_slug === "string" ? body.business_slug.trim() : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!businessSlug || !sessionId || !text) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const access = await requireBusinessAccess(admin, user.id, businessSlug);
    if (!access.ok) {
      const status =
        access.error === "forbidden" ? 403 : access.error === "business_not_found" ? 404 : 400;
      return NextResponse.json({ error: access.error }, { status });
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

