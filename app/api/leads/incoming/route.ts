import { NextRequest, NextResponse } from "next/server";
import { logMessage } from "@/lib/analytics";
import { verifyLeadsWebhookSecret } from "@/lib/leads/webhook-auth";
import {
  buildTemplateIncomingContactPatch,
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  leadTemplateUsesFirstName,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { dispatchCrmEvent } from "@/lib/crm/dispatch";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildWaSessionId, normalizePhone } from "@/lib/phone-normalize";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export const runtime = "nodejs";

type IncomingLeadBody = {
  full_name?: unknown;
  phone?: unknown;
  email?: unknown;
  business_slug?: unknown;
};

type IncomingWebhookAuditResult =
  | "unauthorized"
  | "business_not_found"
  | "validated"
  | "template_sent"
  | "error";

async function writeIncomingAudit(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  body: Record<string, unknown> | null;
  result: IncomingWebhookAuditResult;
  statusCode: number;
  errorDetail?: string | null;
}) {
  try {
    const body = input.body;
    const fullNameRaw = body?.full_name;
    const { error } = await input.admin.from("webhook_audit").insert({
      source: "leads_incoming",
      business_slug:
        body?.business_slug != null ? String(body.business_slug) : null,
      phone: body?.phone != null ? String(body.phone) : null,
      full_name:
        fullNameRaw != null && String(fullNameRaw).trim()
          ? String(fullNameRaw).trim()
          : null,
      external_ids: null,
      result: input.result,
      status_code: input.statusCode,
      raw_body: body,
      error_detail: input.errorDetail ?? null,
    });
    if (error) {
      console.error(
        "[api/leads/incoming] webhook_audit insert failed:",
        error.message
      );
    }
  } catch (e) {
    console.error("[api/leads/incoming] webhook_audit write failed:", e);
  }
}

export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  const providedSecret = req.headers.get("x-leads-secret")?.trim() ?? "";
  type AuthPath = "token" | "legacy_slug";
  let authPath: AuthPath | null = null;
  let tokenBusiness: {
    id: unknown;
    slug: unknown;
    lead_template_name?: string | null;
  } | null = null;

  // 1) Per-business token first (ignore business_slug when matched).
  if (providedSecret) {
    const { data: tokenRows, error: tokenLookupErr } = await admin
      .from("businesses")
      .select("id, slug, lead_template_name")
      .eq("leads_webhook_secret", providedSecret)
      .limit(2);

    if (tokenLookupErr) {
      console.error(
        "[api/leads/incoming] token business lookup failed:",
        tokenLookupErr
      );
    } else if (tokenRows?.length === 1) {
      tokenBusiness = tokenRows[0];
      authPath = "token";
    }
  }

  // 2) Legacy global secret + business_slug (Sangha / Zapier).
  if (!authPath) {
    if (!verifyLeadsWebhookSecret(req)) {
      await writeIncomingAudit({
        admin,
        body: null,
        result: "unauthorized",
        statusCode: 401,
        errorDetail: "unauthorized",
      });
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    authPath = "legacy_slug";
  }

  let body: IncomingLeadBody;
  try {
    body = (await req.json()) as IncomingLeadBody;
  } catch (e) {
    console.error("[api/leads/incoming] invalid JSON:", e);
    await writeIncomingAudit({
      admin,
      body: null,
      result: "error",
      statusCode: 400,
      errorDetail: "invalid_json",
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const bodyRecord = body as Record<string, unknown>;
  const fullName = String(body.full_name ?? "").trim();
  let businessSlug = String(body.business_slug ?? "").trim().toLowerCase();
  const phoneNorm = normalizePhone(body.phone);

  if (!phoneNorm) {
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 400,
      errorDetail: "invalid_phone",
    });
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  let business: {
    id: unknown;
    slug: unknown;
    lead_template_name?: string | null;
  };

  if (authPath === "token" && tokenBusiness) {
    business = tokenBusiness;
    businessSlug = String(tokenBusiness.slug ?? "").trim().toLowerCase();
  } else {
    if (!businessSlug) {
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "error",
        statusCode: 400,
        errorDetail: "missing_business_slug",
      });
      return NextResponse.json({ error: "missing_business_slug" }, { status: 400 });
    }

    const { data: slugBusiness, error: bizErr } = await admin
      .from("businesses")
      .select("id, slug, lead_template_name")
      .eq("slug", businessSlug)
      .maybeSingle();

    if (bizErr) {
      console.error("[api/leads/incoming] business lookup failed:", bizErr);
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "error",
        statusCode: 500,
        errorDetail: "business_lookup_failed",
      });
      return NextResponse.json({ error: "business_lookup_failed" }, { status: 500 });
    }
    if (!slugBusiness?.id) {
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "business_not_found",
        statusCode: 404,
        errorDetail: "business_not_found",
      });
      return NextResponse.json({ error: "business_not_found" }, { status: 404 });
    }
    business = slugBusiness;
  }

  const businessId = Number(business.id);
  if (!Number.isFinite(businessId)) {
    console.error("[api/leads/incoming] invalid business id:", business.id);
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 500,
      errorDetail: "business_lookup_failed",
    });
    return NextResponse.json({ error: "business_lookup_failed" }, { status: 500 });
  }

  const templateName = String((business as { lead_template_name?: string | null }).lead_template_name ?? "").trim();
  if (!templateName) {
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 400,
      errorDetail: "no lead template configured",
    });
    return NextResponse.json({ error: "no lead template configured" }, { status: 400 });
  }

  // Preserve pre-helper reason codes: DB failure → 500 channel_lookup_failed; empty → 404.
  const { error: channelErr } = await admin
    .from("whatsapp_channels")
    .select("id")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .limit(1);
  if (channelErr) {
    console.error("[api/leads/incoming] whatsapp channel lookup failed:", channelErr);
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 500,
      errorDetail: "channel_lookup_failed",
    });
    return NextResponse.json({ error: "channel_lookup_failed" }, { status: 500 });
  }

  const channel = await resolveSendChannelForContact(admin, businessId, phoneNorm);
  if (!channel?.phoneNumberId) {
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 404,
      errorDetail: "whatsapp_channel_not_found",
    });
    return NextResponse.json({ error: "whatsapp_channel_not_found" }, { status: 404 });
  }

  const phoneNumberId = String(channel.phoneNumberId).trim();
  const nowIso = new Date().toISOString();

  await writeIncomingAudit({
    admin,
    body: bodyRecord,
    result: "validated",
    statusCode: 200,
    errorDetail: authPath,
  });

  const { error: upsertErr } = await admin.from("contacts").upsert(
    {
      phone: phoneNorm,
      business_id: businessId,
      full_name: fullName || null,
      ...buildTemplateIncomingContactPatch(nowIso),
    },
    { onConflict: "business_id,phone" }
  );

  if (upsertErr) {
    console.error("[api/leads/incoming] contacts upsert failed:", upsertErr);
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 500,
      errorDetail: "contact_upsert_failed",
    });
    return NextResponse.json({ error: "contact_upsert_failed" }, { status: 500 });
  }

  const firstName = firstNameFromFullName(fullName);
  const sendResult = await sendBusinessTemplate({
    to: phoneNorm,
    phoneNumberId,
    templateName,
    languageCode: "he",
    ...(leadTemplateUsesFirstName(templateName)
      ? {
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: firstName }],
            },
          ],
        }
      : {}),
  });

  if (!sendResult.ok) {
    console.error("[api/leads/incoming] template send failed:", sendResult.error);
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 502,
      errorDetail: "template_send_failed",
    });
    return NextResponse.json({ error: "template_send_failed" }, { status: 502 });
  }

  const sessionId = buildWaSessionId(phoneNumberId, phoneNorm);
  await logMessage({
    business_slug: businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(templateName, { firstName }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: sessionId || null,
  });

  await dispatchCrmEvent({
    businessId,
    leadPhone: phoneNorm,
    kind: "template_sent",
    fullName: fullName || null,
    eventAtIso: nowIso,
  });

  await writeIncomingAudit({
    admin,
    body: bodyRecord,
    result: "template_sent",
    statusCode: 200,
  });

  return NextResponse.json({ ok: true });
}
