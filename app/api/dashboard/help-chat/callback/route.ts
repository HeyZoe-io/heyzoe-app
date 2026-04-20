import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Body = {
  slug: string;
  thread_id: number;
  phone: string;
};

async function requireUser(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  const slug = String(body?.slug ?? "").trim().toLowerCase();
  const threadId = Number(body?.thread_id);
  const phone = String(body?.phone ?? "").trim();
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  if (!Number.isFinite(threadId) || threadId <= 0) return NextResponse.json({ error: "missing_thread_id" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "missing_phone" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: thread } = await admin
    .from("support_requests")
    .select("id, user_id, business_slug")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread || String(thread.user_id) !== user.id || String(thread.business_slug) !== slug) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  await admin
    .from("support_requests")
    .update({
      callback_phone: phone,
      callback_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    } as any)
    .eq("id", threadId);

  await admin.from("support_request_messages").insert({
    request_id: threadId,
    role: "system",
    content: `בעל העסק ביקש חזרה טלפונית. מספר לחזרה: ${phone}`,
    model_used: "callback_request",
  });

  return NextResponse.json({ ok: true });
}

