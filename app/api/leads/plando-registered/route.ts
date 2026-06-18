import { NextRequest, NextResponse } from "next/server";
import { handlePlandoCustomerRegistered } from "@/lib/leads/plando-registered";
import { verifyLeadsWebhookSecret } from "@/lib/leads/webhook-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Webhook: פלנדו → זואי כשליד הופך ל«לקוח» (תבנית API / תהליך אוטומטי).
 * אימות: header `x-leads-secret` = LEADS_WEBHOOK_SECRET.
 * Body (JSON): phone, full_name (או name), business_slug; אופציונלי plando_contact_id, plando_record_id.
 */
export async function POST(req: NextRequest) {
  if (!verifyLeadsWebhookSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (e) {
    console.error("[api/leads/plando-registered] invalid JSON:", e);
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const result = await handlePlandoCustomerRegistered({ admin, body });

  if (!result.ok) {
    const status =
      result.error === "business_not_found" || result.error === "contact_not_found"
        ? 404
        : result.error === "contact_opted_out" || result.error === "contact_not_relevant"
          ? 400
          : result.error === "invalid_phone" || result.error === "missing_business_slug"
            ? 400
            : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  if ("already" in result && result.already) {
    return NextResponse.json({ ok: true, already: true });
  }

  const success = result as Extract<typeof result, { trial_registered_at: string }>;
  return NextResponse.json({
    ok: true,
    trial_registered_at: success.trial_registered_at,
    whatsapp: success.whatsapp,
    contact_created: success.contact_created,
  });
}
