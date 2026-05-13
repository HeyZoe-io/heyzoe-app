import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

function parseFacts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("marketing_flow_settings").select("open_facts").eq("id", 1).maybeSingle();
    if (error) {
      if (/open_facts|column/i.test(error.message)) {
        return NextResponse.json({ facts: [] as string[], notice: "missing_column" });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ facts: parseFacts((data as { open_facts?: unknown } | null)?.open_facts) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "get_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { facts?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const facts = parseFacts(body.facts)
    .map((s) => s.slice(0, 900))
    .slice(0, 80);

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("marketing_flow_settings")
      .update({ open_facts: facts, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) {
      if (/open_facts|column/i.test(error.message)) {
        return NextResponse.json(
          {
            error:
              "חסרה עמודת open_facts ב-Supabase. הריצו את הקובץ supabase/marketing_flow_open_facts.sql ב-SQL Editor.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, facts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save_failed" }, { status: 500 });
  }
}
