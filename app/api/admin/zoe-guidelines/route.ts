import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES } from "@/lib/business-zoe-platform-defaults";
import {
  invalidateZoePlatformGuidelinesCache,
  isUsingDefaultZoePlatform,
  mergeWithDefaultZoePlatform,
  sanitizeZoePlatformForSave,
} from "@/lib/business-zoe-platform";
import type { ZoePlatformGuidelines } from "@/lib/business-zoe-platform-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

function parseStored(raw: unknown): ZoePlatformGuidelines | null {
  if (!raw || typeof raw !== "object") return null;
  const sanitized = sanitizeZoePlatformForSave(raw);
  return sanitized.categories.length ? sanitized : null;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("zoe_platform_settings")
      .select("guidelines")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (/zoe_platform_settings|guidelines|relation/i.test(error.message)) {
        return NextResponse.json({
          guidelines: DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES,
          using_defaults: true,
          notice: "missing_table",
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const stored = parseStored((data as { guidelines?: unknown } | null)?.guidelines);
    const usingDefaults = isUsingDefaultZoePlatform(stored);
    return NextResponse.json({
      guidelines: usingDefaults ? DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES : stored!,
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
  let body: { guidelines?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sanitized = sanitizeZoePlatformForSave(body.guidelines);
  if (!sanitized.categories.length) {
    return NextResponse.json({ error: "empty_guidelines" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("zoe_platform_settings")
      .upsert({
        id: 1,
        guidelines: sanitized,
        updated_at: new Date().toISOString(),
      });
    if (error) {
      if (/zoe_platform_settings|guidelines|relation/i.test(error.message)) {
        return NextResponse.json(
          {
            error:
              "חסרה טבלת zoe_platform_settings ב-Supabase. הריצו: supabase/zoe_platform_settings.sql",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    invalidateZoePlatformGuidelinesCache();
    return NextResponse.json({
      ok: true,
      guidelines: mergeWithDefaultZoePlatform(sanitized),
      using_defaults: false,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save_failed" }, { status: 500 });
  }
}
