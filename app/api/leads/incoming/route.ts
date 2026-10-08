import { NextRequest, NextResponse } from "next/server";
import { logMessage } from "@/lib/analytics";
import { verifyLeadsWebhookSecret } from "@/lib/leads/webhook-auth";
import {
  parseIncomingLeadBodyText,
  parseIncomingLeadFields,
} from "@/lib/leads/parse-incoming-lead-fields";
import {
  buildTemplateIncomingContactPatch,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
  type OpeningTemplateLeadSource,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { dispatchCrmEvent } from "@/lib/crm/dispatch";
import {
  loadBusinessActiveProductKeys,
  matchesActiveProduct,
} from "@/lib/leads/arbox-active-product";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { isSendsHoldError } from "@/lib/business-sends-hold";
import {
  buildSiteLeadScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { incomingFallbackClaimKey, incomingFallbackWindow } from "@/lib/leads/incoming-fallback-claim";
import { sendWithSyncLogClaim, settleForSendError } from "@/lib/leads/sync-log-claim";
import {
  companionTemplateAlreadySent,
  createCompanionSendGate,
  recordCompanionTemplateSent,
  settleCompanionTemplateSent,
  rulesForCompanionSend,
} from "@/lib/same-trigger-template-order";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import { loadEnabledSiteLeadTemplateTriggers } from "@/lib/template-triggers-match";
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
  // One equality lookup on the plaintext column. No decrypt and no extra query.
  // Dual-write keeps that column filled, so accept/reject is unchanged when
  // FIELD_ENCRYPTION_KEY is missing.
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

  const siteRules = rulesForCompanionSend(
    await loadEnabledSiteLeadTemplateTriggers(admin, businessId)
  );
  const fallbackTemplate = String(
    (business as { lead_template_name?: string | null }).lead_template_name ?? ""
  ).trim();
  const usingRule = siteRules.length > 0;
  const templateName = usingRule
    ? String(siteRules[0]?.template_name ?? "").trim()
    : fallbackTemplate;

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

  const activeProducts = await loadBusinessActiveProductKeys({ admin, businessId, now });
  if (!activeProducts.ok) {
    console.error("[api/leads/incoming] active product check failed:", activeProducts.error);
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 502,
      errorDetail: "active_product_check_failed",
    });
    return NextResponse.json({ error: "active_product_check_failed" }, { status: 502 });
  }
  if (
    activeProducts.keys &&
    matchesActiveProduct({ userId: null, phone: phoneNorm, keys: activeProducts.keys })
  ) {
    console.info("[api/leads/incoming] skip — active membership, punch card, or trial", {
      businessId,
    });
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "validated",
      statusCode: 200,
      errorDetail: "skipped_active_product",
    });
    return NextResponse.json({ ok: true, dispatch: "skipped_active" });
  }

  if (usingRule) {
    const companion = createCompanionSendGate();
    let sentImmediate = 0;
    let deferred = 0;
    let gated = 0;
    let already = 0;
    let hardError: "enqueue_failed" | "template_send_failed" | null = null;

    for (const rule of siteRules) {
      const ruleTemplate = String(rule.template_name ?? "").trim();
      const dedupKey = buildSiteLeadScheduledDedupKey(businessId, rule.id, phoneNorm, utcYmd(now));
      const alreadySent = await companionTemplateAlreadySent(admin, dedupKey, {
        businessId,
        triggerId: rule.id,
      });
      if (alreadySent == null) {
        hardError = "template_send_failed";
        break;
      }
      if (alreadySent) {
        already += 1;
        continue;
      }

      if (rule.delay_days > 0) {
        const dueAt = computeDueAt(
          { delay_days: rule.delay_days, delay_direction: "after" },
          now
        );
        const enqueueResult = await enqueueScheduledTemplateSend({
          admin,
          businessId,
          triggerId: rule.id,
          contactPhone: phoneNorm,
          templateName: ruleTemplate,
          dueAt,
          dedupKey,
        });
        console.info("[api/leads/incoming] template trigger resolution", {
          businessId,
          matched_rule_id: rule.id,
          template_name: ruleTemplate,
          dispatch: "deferred" satisfies DispatchOutcome,
          delay_days: rule.delay_days,
          due_at: dueAt.toISOString(),
          enqueue_ok: enqueueResult.ok,
          contact_source: contactSource,
        });
        if (!enqueueResult.ok) hardError = "enqueue_failed";
        else deferred += 1;
        continue;
      }

      const slot = await companion.before(ruleTemplate);
      if (slot === "skip") continue;

      const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
        admin.from("businesses").select("waba_id, name").eq("id", businessId).maybeSingle(),
        admin
          .from("whatsapp_templates")
          .select("id, status, language, components")
          .eq("business_id", businessId)
          .eq("name", ruleTemplate)
          .eq("status", "APPROVED")
          .eq("disabled", false)
          .limit(1)
          .maybeSingle(),
      ]);
      const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
        .trim()
        .replace(/\s+/g, "");
      if (!phoneNumberId || !wabaId || !approvedTpl?.id) {
        companion.after(ruleTemplate, "gated");
        gated += 1;
        continue;
      }
      const firstName = resolveTemplateFirstName({ full_name: fullName });
      if (
        !firstName &&
        templateBodyUsesFirstNameSlot("incoming_lead", (approvedTpl as { components?: unknown }).components)
      ) {
        companion.after(ruleTemplate, "gated");
        gated += 1;
        continue;
      }
      const languageCode =
        String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
      const { sendComponents, bodyParams } = templateSendPayload({
        triggerType: "incoming_lead",
        storedComponents: (approvedTpl as { components?: unknown }).components,
        firstName,
        businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
      });
      const claimed = await recordCompanionTemplateSent(admin, {
        dedupKey,
        businessId,
        ruleId: rule.id,
        phone: phoneNorm,
        templateName: ruleTemplate,
        nowIso,
      });
      if (claimed == null) {
        hardError = "template_send_failed";
        break;
      }
      if (!claimed) {
        already += 1;
        continue;
      }
      const sendResult = await sendBusinessTemplate({
        to: phoneNorm,
        phoneNumberId,
        templateName: ruleTemplate,
        alertTriggerId: rule.id,
        languageCode,
        ...(sendComponents ? { components: sendComponents } : {}),
      });
      console.info("[api/leads/incoming] template trigger resolution", {
        businessId,
        matched_rule_id: rule.id,
        template_name: ruleTemplate,
        dispatch: "immediate" satisfies DispatchOutcome,
        send_ok: sendResult.ok,
        contact_source: contactSource,
      });
      if (!sendResult.ok) {
        console.error("[api/leads/incoming] template send failed:", sendResult.error);
        if (isSendsHoldError(sendResult.error)) {
          await settleCompanionTemplateSent(admin, dedupKey, "release");
          companion.after(ruleTemplate, "gated");
          gated += 1;
          continue;
        }
        await settleCompanionTemplateSent(admin, dedupKey, "failed");
        companion.after(ruleTemplate, "send_failed");
        hardError = "template_send_failed";
        continue;
      }
      await settleCompanionTemplateSent(admin, dedupKey, "sent");
      companion.after(ruleTemplate, "immediate");
      const sessionId = buildWaSessionId(phoneNumberId, phoneNorm);
      await logMessage({
        business_slug: businessSlug,
        role: "assistant",
        content: formatLeadTemplateMessageContent(ruleTemplate, {
          firstName,
          components: (approvedTpl as { components?: unknown }).components,
          bodyParams,
        }),
        model_used: LEAD_TEMPLATE_MODEL,
        session_id: sessionId || null,
      });
      sentImmediate += 1;
    }

    if (hardError) {
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "error",
        statusCode: 502,
        errorDetail: hardError,
      });
      return NextResponse.json({ error: hardError }, { status: 502 });
    }

    if (sentImmediate > 0) {
      await dispatchCrmEvent({
        businessId,
        leadPhone: phoneNorm,
        kind: "template_sent",
        fullName: fullName || null,
        eventAtIso: nowIso,
      });
    }

    const dispatch: DispatchOutcome =
      sentImmediate > 0 ? "immediate" : deferred > 0 ? "deferred" : already > 0 ? "immediate" : "gated";
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: sentImmediate > 0 ? "template_sent" : "validated",
      statusCode: 200,
      errorDetail: sentImmediate > 0 ? undefined : gated > 0 ? "gated" : undefined,
    });
    return NextResponse.json({
      ok: true,
      dispatch,
      rules: siteRules.length,
      sent: sentImmediate,
      deferred,
      gated,
    });
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

  const firstName = resolveTemplateFirstName({ full_name: fullName });
  if (!firstName && templateBodyUsesFirstNameSlot("legacy_opening", (fallbackTpl as { components?: unknown } | null)?.components)) {
    console.info("[api/leads/incoming] skip", { reason: "no_valid_name", businessId });
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "validated",
      statusCode: 200,
      errorDetail: "gated:no_valid_name",
    });
    return NextResponse.json({ ok: true, dispatch: "gated", gate: "no_valid_name" });
  }
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "legacy_opening",
    storedComponents: (fallbackTpl as { components?: unknown } | null)?.components,
    firstName,
  });
  const sendFallback = () =>
    sendBusinessTemplate({
      to: phoneNorm,
      phoneNumberId,
      templateName,
      languageCode:
        String((fallbackTpl as { language?: string } | null)?.language ?? "he").trim() || "he",
      ...(sendComponents ? { components: sendComponents } : {}),
    });

  const window = await incomingFallbackWindow(admin, businessId, phoneNorm, now);
  if (window.state === "error") {
    console.error("[api/leads/incoming] fallback dedup read failed:", window.error, { businessId });
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "error",
      statusCode: 500,
      errorDetail: "dedup_read_failed",
    });
    return NextResponse.json({ error: "dedup_read_failed" }, { status: 500 });
  }
  if (window.state === "blocked") {
    console.info("[api/leads/incoming] skip", { reason: "opening_template_within_24h", businessId });
    await writeIncomingAudit({
      admin,
      body: bodyRecord,
      result: "validated",
      statusCode: 200,
      errorDetail: "gated:duplicate_24h",
    });
    return NextResponse.json({ ok: true, dispatch: "gated", gate: "duplicate_24h" });
  }

  let sendResult: Awaited<ReturnType<typeof sendBusinessTemplate>>;
  if (window.state === "missing_table") {
    console.error("[api/leads/incoming] incoming_lead_fallback_send_log missing, unclaimed legacy send", { businessId });
    sendResult = await sendFallback();
  } else {
    const claimed = await sendWithSyncLogClaim({
      admin,
      ...incomingFallbackClaimKey(businessId, phoneNorm, templateName, now, window.attempts),
      send: async () => {
        const value = await sendFallback();
        return {
          settle: value.ok ? ("sent" as const) : settleForSendError(value.error),
          reason: value.ok ? null : String(value.error ?? "send_failed").slice(0, 200),
          value,
        };
      },
    });
    if (claimed.claim === "lost") {
      console.info("[api/leads/incoming] skip", { reason: "claim_lost", businessId });
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "validated",
        statusCode: 200,
        errorDetail: "gated:duplicate_24h",
      });
      return NextResponse.json({ ok: true, dispatch: "gated", gate: "duplicate_24h" });
    }
    if (claimed.claim !== "won" || !claimed.value) {
      console.error("[api/leads/incoming] fallback claim failed", { businessId });
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "error",
        statusCode: 500,
        errorDetail: "dedup_claim_failed",
      });
      return NextResponse.json({ error: "dedup_claim_failed" }, { status: 500 });
    }
    sendResult = claimed.value;
  }

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
    if (isSendsHoldError(sendResult.error)) {
      await writeIncomingAudit({
        admin,
        body: bodyRecord,
        result: "validated",
        statusCode: 200,
        errorDetail: "gated:sends_hold",
      });
      return NextResponse.json({ ok: true, dispatch: "gated", gate: "sends_hold" });
    }
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
