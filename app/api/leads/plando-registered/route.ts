import { NextRequest, NextResponse } from "next/server";
import { handlePlandoCustomerRegistered } from "@/lib/leads/plando-registered";
import { verifyLeadsWebhookSecret } from "@/lib/leads/webhook-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type WebhookAuditResult =
  | "registered"
  | "already"
  | "unauthorized"
  | "business_not_found"
  | "contact_not_found"
  | "error";

async function writeAudit(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  body: Record<string, unknown> | null;
  result: WebhookAuditResult;
  statusCode: number;
  errorDetail?: string | null;
}) {
  try {
    const body = input.body;
    const contactId = body?.plando_contact_id ?? body?.contact_id;
    const recordId = body?.plando_record_id ?? body?.record_id;
    const externalIds: Record<string, unknown> = {};
    if (contactId != null && String(contactId).trim()) {
      externalIds.contact_id = contactId;
    }
    if (recordId != null && String(recordId).trim()) {
      externalIds.record_id = recordId;
    }

    const fullNameRaw = body?.full_name ?? body?.name;
    const { error } = await input.admin.from("webhook_audit").insert({
      source: "plando",
      business_slug:
        body?.business_slug != null ? String(body.business_slug) : null,
      phone: body?.phone != null ? String(body.phone) : null,
      full_name:
        fullNameRaw != null && String(fullNameRaw).trim()
          ? String(fullNameRaw).trim()
          : null,
      external_ids: Object.keys(externalIds).length ? externalIds : null,
      result: input.result,
      status_code: input.statusCode,
      raw_body: body,
      error_detail: input.errorDetail ?? null,
    });
    if (error) {
      console.error(
        "[api/leads/plando-registered] webhook_audit insert failed:",
        error.message
      );
    }
  } catch (e) {
    console.error("[api/leads/plando-registered] webhook_audit write failed:", e);
  }
}

/**
 * Webhook: פלנדו → זואי כשליד הופך ל«לקוח» (תבנית API / תהליך אוטומטי).
 * אימות: header `x-leads-secret` = LEADS_WEBHOOK_SECRET.
 * Body (JSON): phone, full_name (או name), business_slug; אופציונלי plando_contact_id, plando_record_id.
 */
export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  if (!verifyLeadsWebhookSecret(req)) {
    await writeAudit({
      admin,
      body: null,
      result: "unauthorized",
      statusCode: 401,
      errorDetail: "unauthorized",
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (e) {
    console.error("[api/leads/plando-registered] invalid JSON:", e);
    await writeAudit({
      admin,
      body: null,
      result: "error",
      statusCode: 400,
      errorDetail: "invalid_json",
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = await handlePlandoCustomerRegistered({ admin, body });

  if (!result.ok) {
    const status =
      result.error === "business_not_found" || result.error === "contact_not_found"
        ? 404
        : result.error === "invalid_phone" || result.error === "missing_business_slug"
          ? 400
          : 500;
    const auditResult: WebhookAuditResult =
      result.error === "business_not_found"
        ? "business_not_found"
        : result.error === "contact_not_found"
          ? "contact_not_found"
          : "error";
    await writeAudit({
      admin,
      body,
      result: auditResult,
      statusCode: status,
      errorDetail: result.error,
    });
    return NextResponse.json({ error: result.error }, { status });
  }

  if ("already" in result && result.already) {
    await writeAudit({
      admin,
      body,
      result: "already",
      statusCode: 200,
    });
    return NextResponse.json({ ok: true, already: true });
  }

  const success = result as Extract<typeof result, { trial_registered_at: string }>;
  await writeAudit({
    admin,
    body,
    result: "registered",
    statusCode: 200,
  });
  return NextResponse.json({
    ok: true,
    trial_registered_at: success.trial_registered_at,
    whatsapp: success.whatsapp,
    contact_created: success.contact_created,
  });
}
