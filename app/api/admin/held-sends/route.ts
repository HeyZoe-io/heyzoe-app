import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { cancelHeld, releaseHeld, resumeTriggerPause, type HeldSelector } from "@/lib/send-plan/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function adminEmail(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase() ?? "";
  return email && isAdminAllowedEmail(email) ? email : null;
}

function parseSelector(body: Record<string, unknown>): HeldSelector | null {
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  const group = body.group as { business_id?: unknown; reason?: unknown } | undefined;
  const businessId = Number(group?.business_id);
  const reason = typeof group?.reason === "string" ? group.reason.trim() : "";
  if (ids.length) return { ids };
  if (Number.isFinite(businessId) && businessId > 0 && reason) return { group: { businessId, reason } };
  return null;
}

/** Release / cancel held sends, per item (ids) or per group (business + reason); resume a breaker pause. */
export async function POST(req: NextRequest) {
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const action = body.action;

  if (action === "resume") {
    const businessId = Number(body.business_id);
    const triggerKey = typeof body.trigger_key === "string" ? body.trigger_key.trim() : "";
    if (!Number.isFinite(businessId) || !triggerKey) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    const ok = await resumeTriggerPause(admin, businessId, triggerKey, email);
    return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
  }
  if (action !== "release" && action !== "cancel") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const selector = parseSelector(body);
  if (!selector) return NextResponse.json({ error: "missing_selector" }, { status: 400 });
  try {
    const result = action === "release" ? await releaseHeld(admin, selector, email) : await cancelHeld(admin, selector, email);
    return NextResponse.json({ ok: result.failed === 0, ...result });
  } catch (e) {
    console.error("[api/admin/held-sends] action failed:", action, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "action_failed" }, { status: 500 });
  }
}
