import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { META_PRICING_NOTICE_KEY } from "@/lib/meta-pricing-notice";

export const runtime = "nodejs";

const ALLOWED_NOTICE_KEYS = new Set<string>([META_PRICING_NOTICE_KEY]);

type Body = {
  business_slug?: string;
  notice_key?: string;
};

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const businessSlug = String(body.business_slug ?? "").trim().toLowerCase();
  if (!businessSlug) {
    return NextResponse.json({ error: "missing_business_slug" }, { status: 400 });
  }

  const noticeKey = String(body.notice_key ?? "").trim();
  if (!ALLOWED_NOTICE_KEYS.has(noticeKey)) {
    return NextResponse.json({ error: "unknown_notice_key" }, { status: 400 });
  }

  // Access check + business name via service role (avoids business_users RLS recursion).
  // The compliance INSERT below uses the caller's session — RLS is the authority of record.
  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(admin, { id: user.id, email: user.email }, businessSlug);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("name")
    .eq("id", access.business.id)
    .maybeSingle();
  if (bizErr) {
    console.error("[api/dashboard/notice-acknowledgments] business_select_failed", {
      user_id: user.id,
      business_id: access.business.id,
      error: bizErr.message,
    });
    return NextResponse.json({ error: "business_select_failed" }, { status: 500 });
  }

  // Same source as UserMenu / account settings: auth user_metadata, then email.
  // No profiles table; business_users has no name column.
  const userName =
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
    (typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "") ||
    String(user.email ?? "").trim();
  const businessName = String((biz as { name?: string } | null)?.name ?? "").trim() || businessSlug;

  const { error: insertErr } = await supabase.from("notice_acknowledgments").upsert(
    {
      notice_key: noticeKey,
      user_id: user.id,
      user_name: userName,
      business_id: access.business.id,
      business_name: businessName,
    },
    { onConflict: "notice_key,user_id,business_id", ignoreDuplicates: true }
  );

  if (insertErr) {
    console.error("[api/dashboard/notice-acknowledgments] insert_failed", {
      user_id: user.id,
      business_id: access.business.id,
      notice_key: noticeKey,
      error: insertErr.message,
    });
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
