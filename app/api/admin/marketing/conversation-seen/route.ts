import { NextRequest, NextResponse } from "next/server";
import { logMessage } from "@/lib/analytics";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import {
  canonicalMarketingSessionId,
  MARKETING_ADMIN_SEEN_MODEL,
  MARKETING_CONVERSATIONS_SLUG,
} from "@/lib/marketing-whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

/** פתיחת שיחה באדמין מבטלת את הבולד עד ההודעה הבאה של הליד. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { session_id?: string };
  try {
    body = (await req.json()) as { session_id?: string };
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const sessionId = canonicalMarketingSessionId(String(body.session_id ?? "").trim());
  if (!sessionId || sessionId.endsWith("_")) {
    return NextResponse.json({ error: "missing_session_id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("role, model_used, created_at")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) {
    console.error("[conversation-seen] lookup failed:", error.message);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  for (const row of data ?? []) {
    const role = String((row as { role?: string }).role ?? "");
    const model = String((row as { model_used?: string }).model_used ?? "");
    if (role === "user") break;
    if (role === "assistant") return NextResponse.json({ ok: true, skipped: true });
    if (role === "event" && model === MARKETING_ADMIN_SEEN_MODEL) {
      return NextResponse.json({ ok: true, skipped: true });
    }
  }

  await logMessage({
    business_slug: MARKETING_CONVERSATIONS_SLUG,
    role: "event",
    content: "[heyzoe:marketing_admin_seen]",
    model_used: MARKETING_ADMIN_SEEN_MODEL,
    session_id: sessionId,
  });

  return NextResponse.json({ ok: true });
}
