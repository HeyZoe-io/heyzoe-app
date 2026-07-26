import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import {
  dismissKnowledgeGap,
  findKnowledgeGaps,
} from "@/lib/analytics-knowledge-gaps";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const businessSlug = url.searchParams.get("business_slug")?.trim().toLowerCase() ?? "";
  if (!businessSlug) {
    return NextResponse.json({ error: "missing_business_slug" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    businessSlug
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const items = await findKnowledgeGaps({ admin, businessSlug });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("[api/analytics/knowledge-gaps] GET failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { business_slug?: unknown; assistant_message_id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const businessSlug = String(body.business_slug ?? "").trim().toLowerCase();
  const assistantMessageId = Number(body.assistant_message_id);
  if (!businessSlug || !Number.isFinite(assistantMessageId) || assistantMessageId <= 0) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    businessSlug
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const result = await dismissKnowledgeGap({
    admin,
    businessSlug,
    assistantMessageId,
    dismissedBy: user.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
