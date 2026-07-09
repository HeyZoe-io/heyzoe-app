import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const businessSlug =
      typeof body.business_slug === "string" ? body.business_slug.trim().toLowerCase() : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";

    if (!businessSlug || !sessionId) {
      return NextResponse.json({ error: "missing business_slug_or_session_id" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const access = await assertBusinessAccess(admin, { id: user.id, email: user.email }, businessSlug);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const businessId = access.business.id;
    const { extractPhoneFromSessionId } = await import("@/lib/conversations-sessions");
    const { setConversationBotPaused } = await import("@/lib/notifications/conversations");
    const leadPhone = extractPhoneFromSessionId(sessionId) || sessionId;
    await setConversationBotPaused({
      businessId,
      phone: leadPhone,
      sessionId,
      paused: false,
    });

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

