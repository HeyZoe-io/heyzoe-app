import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { whatsAppIsraelSendWindowSummaryHe } from "@/lib/israel-time";
import {
  marketingFollowupConfigToJson,
  resolveMarketingFollowupConfig,
  validateMarketingFollowupConfig,
} from "@/lib/marketing-followup-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_flow_settings")
      .select("marketing_followups")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (/marketing_followups|column/i.test(error.message)) {
        const fallback = resolveMarketingFollowupConfig(null);
        return NextResponse.json({
          ...marketingFollowupConfigToJson(fallback.config),
          using_defaults: true,
          notice: "missing_column",
          send_window: whatsAppIsraelSendWindowSummaryHe(),
        });
      }
      console.error("[admin/marketing/followups] get:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const row = data as { marketing_followups?: unknown } | null;
    const resolved = resolveMarketingFollowupConfig(row?.marketing_followups);
    return NextResponse.json({
      ...marketingFollowupConfigToJson(resolved.config),
      using_defaults: resolved.usingDefaults,
      send_window: whatsAppIsraelSendWindowSummaryHe(),
    });
  } catch (e) {
    console.error("[admin/marketing/followups] get failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "get_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const validated = validateMarketingFollowupConfig(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const payload = marketingFollowupConfigToJson(validated.config);

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("marketing_flow_settings")
      .update({
        marketing_followups: payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) {
      if (/marketing_followups|column/i.test(error.message)) {
        console.error("[admin/marketing/followups] missing column:", error.message);
        return NextResponse.json(
          {
            error:
              "חסרה עמודת marketing_followups ב-Supabase. הריצו: supabase/marketing_flow_settings_followups.sql",
          },
          { status: 400 }
        );
      }
      console.error("[admin/marketing/followups] save:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      ...payload,
      using_defaults: false,
      send_window: whatsAppIsraelSendWindowSummaryHe(),
    });
  } catch (e) {
    console.error("[admin/marketing/followups] save failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "save_failed" }, { status: 500 });
  }
}
