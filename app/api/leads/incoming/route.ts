import { NextRequest, NextResponse } from "next/server";
import { logMessage } from "@/lib/analytics";
import { verifyLeadsWebhookSecret } from "@/lib/leads/webhook-auth";
import {
  parseIncomingLeadBodyText,
  parseIncomingLeadFields,
} from "@/lib/leads/parse-incoming-lead-fields";
import {
  buildTemplateIncomingContactPatch,
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
  type OpeningTemplateLeadSource,
} from "@/lib/lead-template";
import { dispatchCrmEvent } from "@/lib/crm/dispatch";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import {
  buildSiteLeadScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { templateSendPayload } from "@/lib/template-send-params";
import { resolveSiteLeadTemplateTrigger } from "@/lib/template-triggers-match";
import { buildWaSessionId, normalizePhone } from "@/lib/phone-normalize";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export const runtime = "nodejs";

type IncomingWebhookAuditResult =
  | "unauthorized"
  | "business_not_found"
  | "validated"
  | "template_sent"
  | "error";

type DispatchOutcome = "immediate" | "deferred" | "gated" | "fallback";

async function writeIncomingAudit(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  body: Record<string, unknown> | null;
  result: IncomingWebhookAuditResult;
  statusCode: number;
  errorDetail?: string | null;
}) {
  try {
    const body = input.body;
    const fullNameRaw = body?.full_name ?? body?.name;
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

function utcYmd(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveProvidedSecret(req: NextRequest): string {
  const header = req.headers.get("x-leads-secret")?.trim() ?? "";
  if (header) return header;
  const url = req.nextUrl;
  return (
    url.searchParams.get("token")?.trim() ||
    url.searchParams.get("secret")?.trim() ||
    ""
  );
}

export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  const providedSecret = resolveProvidedSecret(req);
  type AuthPath = "token" | "legacy_slug";
  let authPath: AuthPath | null = null;
  let tokenBusiness: {
    id: unknown;
    slug: unknown;
    lead_template_name?: string | null;
  } | null = null;

  // 1) Per-business token first (header OR ?token= / ?secret= for Elementor).
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

  const rawText = await req.text();
  const bodyRecord = parseIncomingLeadBodyText(rawText, req.headers.get("content-type"));
  if (bodyRecord == null) {
    console.error("[api/leads/incoming] invalid body parse");
    await writeIncomingAudit({
      admin,
      body: null,
      result: "error",
      statusCode: 400,
      errorDetail: "invalid_json",
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseIncomingLeadFields(bodyRecord);
  const fullName = parsed.fullName;
  let businessSlug = parsed.businessSlug;
  const phoneNorm = normalizePhone(parsed.phoneRaw);

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

  const matchedRule = await resolveSiteLeadTemplateTrigger({ admin, businessId });
  const ruleTemplate = matchedRule?.template_name?.trim() || null;
  const fallbackTemplate = String(
    (business as { lead_template_name?: string | null }).lead_template_name ?? ""
  ).trim();
  const templateName = ruleTemplate || fallbackTemplate;
  const usingRule = Boolean(matchedRule && ruleTemplate);

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

  // Matched incoming_lead rule → keep contact source "site_lead" so
  // no-response / wa-status-check crons (meta_lead_ad + site_lead) stay intact.
  // Fallback lead_template_name (no rule) → meta_lead_ad (Sanga / Zapier legacy).
  const contactSource: OpeningTemplateLeadSource = usingRule ? "site_lead" : "meta_lead_ad";

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
  const now = new Date(nowIso);

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
      ...buildTemplateIncomingContactPatch(nowIso, contactSource),
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

  // Rule path with delay → enqueue (Stage C queue).
  if (usingRule && matchedRule && matchedRule.delay_days > 0) {
    const dueAt = computeDueAt(
      { delay_days: matchedRule.delay_days, delay_direction: "after" },
      now
    );
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin,
      businessId,
      triggerId: matchedRule.id,
      contactPhone: phoneNorm,
      templateName,
      dueAt,
      dedupKey: buildSiteLeadScheduledDedupKey(
        businessId,
        matchedRule.id,
        phoneNorm,
        utcYmd(now)
      ),
    });

    console.info("[api/leads/incoming] template trigger resolution", {
      businessId,
      matched_rule_id: matchedRule.id,
      template_name: templateName,
      dispatch: "deferred" satisfies DispatchOutcome,
      delay_days: matchedRule.delay_days,
      due_at: dueAt.toISOString(),
      enqueue_ok: enqueueResult.ok,
      enqueue_inserted: enqueueResult.ok ? enqueueResult.inserted : false,
      enqueue_error: enqueueResult.ok ? undefined : enqueueResult.error,
      contact_source: contactSource,
    });

    if (!enqueueResult.ok) {
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "error",
        statusCode: 502,
        errorDetail: "enqueue_failed",
      });
      return NextResponse.json({ error: "enqueue_failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true, dispatch: "deferred" });
  }

  // Rule path delay=0 → gate like purchase (channel already resolved; check WABA + APPROVED).
  if (usingRule && matchedRule) {
    const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
      admin.from("businesses").select("waba_id, name").eq("id", businessId).maybeSingle(),
      admin
        .from("whatsapp_templates")
        .select("id, status, language, components")
        .eq("business_id", businessId)
        .eq("name", templateName)
        .eq("status", "APPROVED")
        .eq("disabled", false)
        .limit(1)
        .maybeSingle(),
    ]);

    const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
      .trim()
      .replace(/\s+/g, "");

    if (!phoneNumberId || !wabaId || !approvedTpl?.id) {
      const gate = !phoneNumberId ? "no_channel" : !wabaId ? "no_waba" : "template_not_approved";
      console.info("[api/leads/incoming] template trigger resolution", {
        businessId,
        matched_rule_id: matchedRule.id,
        template_name: templateName,
        dispatch: "gated" satisfies DispatchOutcome,
        gate,
        contact_source: contactSource,
      });
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "validated",
        statusCode: 200,
        errorDetail: `gated:${gate}`,
      });
      return NextResponse.json({ ok: true, dispatch: "gated", gate });
    }

    const firstName = firstNameFromFullName(fullName);
    const languageCode =
      String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
    const { sendComponents, bodyParams } = templateSendPayload({
      triggerType: "incoming_lead",
      storedComponents: (approvedTpl as { components?: unknown }).components,
      firstName,
      businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    });

    const sendResult = await sendBusinessTemplate({
      to: phoneNorm,
      phoneNumberId,
      templateName,
      languageCode,
      ...(sendComponents ? { components: sendComponents } : {}),
    });

    console.info("[api/leads/incoming] template trigger resolution", {
      businessId,
      matched_rule_id: matchedRule.id,
      template_name: templateName,
      dispatch: "immediate" satisfies DispatchOutcome,
      send_ok: sendResult.ok,
      contact_source: contactSource,
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
      content: formatLeadTemplateMessageContent(templateName, {
        firstName,
        components: (approvedTpl as { components?: unknown }).components,
        bodyParams,
      }),
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

    return NextResponse.json({ ok: true, dispatch: "immediate" });
  }

  // Fallback: businesses.lead_template_name (Sanga / Zapier) — legacy immediate send.
  // Soft-disable only when we have a cached row; missing cache keeps legacy send behavior.
  const { data: fallbackTpl } = await admin
    .from("whatsapp_templates")
    .select("id, status, disabled, language, components")
    .eq("business_id", businessId)
    .eq("name", templateName)
    .limit(1)
    .maybeSingle();

  if (fallbackTpl && (fallbackTpl as { disabled?: boolean }).disabled === true) {
    console.info("[api/leads/incoming] template trigger resolution", {
      businessId,
      matched_rule_id: "none",
      template_name: templateName,
      dispatch: "gated" satisfies DispatchOutcome,
      gate: "template_disabled",
      contact_source: contactSource,
    });
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "validated",
      statusCode: 200,
      errorDetail: "gated:template_disabled",
    });
    return NextResponse.json({ ok: true, dispatch: "gated", gate: "template_disabled" });
  }

  const firstName = firstNameFromFullName(fullName);
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "legacy_opening",
    storedComponents: (fallbackTpl as { components?: unknown } | null)?.components,
    firstName,
  });
  const sendResult = await sendBusinessTemplate({
    to: phoneNorm,
    phoneNumberId,
    templateName,
    languageCode:
      String((fallbackTpl as { language?: string } | null)?.language ?? "he").trim() || "he",
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  console.info("[api/leads/incoming] template trigger resolution", {
    businessId,
    matched_rule_id: "none",
    template_name: templateName,
    dispatch: "fallback" satisfies DispatchOutcome,
    send_ok: sendResult.ok,
    contact_source: contactSource,
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
    content: formatLeadTemplateMessageContent(templateName, {
      firstName,
      components: (fallbackTpl as { components?: unknown } | null)?.components,
      bodyParams,
    }),
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

  return NextResponse.json({ ok: true, dispatch: "fallback" });
}
