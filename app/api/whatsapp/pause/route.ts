import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessSlug =
      typeof body.business_slug === "string" ? body.business_slug.trim().toLowerCase() : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const minutesRaw = Number(body.minutes ?? 60);
    const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : 60;

    if (!businessSlug || !sessionId) {
      return NextResponse.json({ error: "missing business_slug_or_session_id" }, { status: 400 });
    }

    const until = new Date();
    until.setMinutes(until.getMinutes() + minutes);

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
        paused: true,
      });
    }

    const { error } = await admin.from("paused_sessions").upsert(
      {
        business_slug: businessSlug,
        session_id: sessionId,
        paused_until: until.toISOString(),
      },
      {
        onConflict: "business_slug,session_id",
      } as any
    );
    if (error) {
      console.error("[api/whatsapp/pause] upsert failed:", error.message);
      return NextResponse.json({ error: "pause_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, paused_until: until.toISOString() });
  } catch (e) {
    console.error("[api/whatsapp/pause] failed:", e);
    return NextResponse.json({ error: "pause_failed" }, { status: 500 });
  }
}

