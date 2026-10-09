import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { isMarketingConversationsSlug } from "@/lib/marketing-whatsapp";
import { isBusinessWaSessionPaused } from "@/lib/wa-app-echo-pause";
import {
  INBOUND_REPLAY_REQUEST_MODEL,
  parseWaSessionId,
  pickUnansweredInbound,
  type InboundReplayRow,
} from "@/lib/wa-inbound-replay";

export const runtime = "nodejs";

/** Queues a replay of the lead's last unanswered message; the wa-followups cron runs it. */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const businessSlug =
      typeof body.business_slug === "string" ? body.business_slug.trim().toLowerCase() : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!businessSlug || !sessionId || isMarketingConversationsSlug(businessSlug) || !parseWaSessionId(sessionId)) {
      return NextResponse.json({ error: "invalid_session" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const access = await assertBusinessAccess(admin, { id: user.id, email: user.email }, businessSlug);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    if (await isBusinessWaSessionPaused({ admin, businessSlug, sessionIds: [sessionId] })) {
      return NextResponse.json({ error: "session_paused" }, { status: 409 });
    }

    const { data: rows, error: rowsErr } = await admin
      .from("messages")
      .select("id, created_at, role, content, model_used")
      .eq("business_slug", businessSlug)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (rowsErr) {
      console.error("[api/whatsapp/replay-last-inbound] lookup failed:", rowsErr.message);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }
    const list = (rows ?? []) as InboundReplayRow[];
    if (list.some((r) => r.model_used === INBOUND_REPLAY_REQUEST_MODEL)) {
      return NextResponse.json({ ok: true, already_queued: true });
    }
    const pick = pickUnansweredInbound(list, new Date());
    if (!pick.ok) return NextResponse.json({ error: pick.reason }, { status: 409 });

    const { error } = await admin.from("messages").insert({
      business_slug: businessSlug,
      session_id: sessionId,
      role: "event",
      model_used: INBOUND_REPLAY_REQUEST_MODEL,
      content: "[heyzoe:inbound_replay] המשך מההודעה האחרונה של הליד",
    });
    if (error) {
      console.error("[api/whatsapp/replay-last-inbound] enqueue failed:", error.message);
      return NextResponse.json({ error: "enqueue_failed" }, { status: 500 });
    }
    console.info("[api/whatsapp/replay-last-inbound] queued", { businessSlug, sessionId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/whatsapp/replay-last-inbound] failed:", e);
    return NextResponse.json({ error: "replay_failed" }, { status: 500 });
  }
}
