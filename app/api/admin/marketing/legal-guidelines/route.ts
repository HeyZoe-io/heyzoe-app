import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES } from "@/lib/marketing-zoe-legal-defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

function parseLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_flow_settings")
      .select("marketing_legal_guidelines")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (/marketing_legal_guidelines|column/i.test(error.message)) {
        return NextResponse.json({
          lines: DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES,
          using_defaults: true,
          notice: "missing_column",
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const row = data as { marketing_legal_guidelines?: unknown } | null;
    const stored = parseLines(row?.marketing_legal_guidelines);
    const usingDefaults = stored.length === 0;
    return NextResponse.json({
      lines: usingDefaults ? DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES : stored,
      using_defaults: usingDefaults,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "get_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { lines?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const rawArr = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawArr
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 900))
    .slice(0, 60);

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("marketing_flow_settings")
      .update({
        marketing_legal_guidelines: lines,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) {
      if (/marketing_legal_guidelines|column/i.test(error.message)) {
        return NextResponse.json(
          {
            error:
              "חסרה עמודת marketing_legal_guidelines ב-Supabase. הריצו: supabase/marketing_flow_settings_legal_guidelines.sql (או עדכנו את supabase/marketing_flow.sql).",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const usingDefaults = lines.length === 0;
    return NextResponse.json({
      ok: true,
      lines: usingDefaults ? DEFAULT_MARKETING_ZOE_LEGAL_GUIDELINES : lines,
      using_defaults: usingDefaults,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save_failed" }, { status: 500 });
  }
}
