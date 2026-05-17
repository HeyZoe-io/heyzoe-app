import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessSlug =
      typeof body.business_slug === "string" ? body.business_slug.trim().toLowerCase() : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";

    if (!businessSlug || !sessionId) {
      return NextResponse.json({ error: "missing business_slug_or_session_id" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const { data: biz } = await admin.from("businesses").select("id").eq("slug", businessSlug).maybeSingle();
    const businessId = biz?.id ? Number(biz.id) : null;
    if (businessId) {
      const { extractPhoneFromSessionId } = await import("@/lib/conversations-sessions");
      const { setConversationBotPaused } = await import("@/lib/notifications/conversations");
      const leadPhone = extractPhoneFromSessionId(sessionId) || sessionId;
      await setConversationBotPaused({
        businessId,
        phone: leadPhone,
        sessionId,
        paused: false,
      });
    }

    const { error } = await admin
      .from("paused_sessions")
      .delete()
      .eq("business_slug", businessSlug)
      .eq("session_id", sessionId);

    if (error) {
      console.error("[api/whatsapp/unpause] delete failed:", error.message);
      return NextResponse.json({ error: "unpause_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/whatsapp/unpause] failed:", e);
    return NextResponse.json({ error: "unpause_failed" }, { status: 500 });
  }
}

