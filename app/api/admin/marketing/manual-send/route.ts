import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { extractLeadPhoneFromMarketingSession, sendMarketingWhatsApp } from "@/lib/marketing-whatsapp";

export const runtime = "nodejs";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { session_id?: string; text?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionId = String(body.session_id ?? "").trim();
  const text = String(body.text ?? "").trim();
  if (!sessionId || !text) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const leadPhone = extractLeadPhoneFromMarketingSession(sessionId);
  if (!leadPhone) {
    return NextResponse.json({ error: "invalid_session_format" }, { status: 400 });
  }

  try {
    await sendMarketingWhatsApp(leadPhone, text, { model_used: "manual_handoff" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "manual_send_failed" },
      { status: 500 }
    );
  }
}
