import { HEYZOE_SF_REGISTERED, logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import {
  buildPurchaseScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import { resolvePurchaseTemplateTriggerForSale } from "@/lib/template-triggers-match";
import { delayDirectionForTrigger } from "@/lib/template-trigger-types";
import { buildTrialRegisteredContactPatch } from "@/lib/trial-registered-manual";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendTrialRegisteredWhatsAppReplyIfInWindow } from "@/lib/trial-registered-wa-reply";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

/** One row from Arbox GET /v3/reports/salesReport `data[]`. */
export type ArboxSalesReportRow = {
  sale_id: unknown;
  user_id: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  date?: unknown;
  membership_type_id: unknown;
  item_name?: unknown;
  paid?: unknown;
  debt?: unknown;
  price?: unknown;
};

/** Payment-link / invoice still open — not a completed registration. */
export function arboxSaleHasOutstandingDebt(row: { debt?: unknown }): boolean {
  const debt = Number(row.debt);
  return Number.isFinite(debt) && debt > 0;
}

export type ArboxTrialSaleRegisteredResult =
  | { ok: true; already: true }
  | { ok: true; unpaid: true }
  | {
      ok: true;
      trial_registered_at: string;
      whatsapp:
        | "sent"
        | "no_channel"
        | "outside_24h_window"
        | "no_user_session"
        | "send_failed"
        | "throttled_2d"
        | "template_not_configured"
        | "no_matching_rule"
        | "deferred";
      contact_created: boolean;
    }
  | { ok: false; error: string };

const MS_2_DAYS = 2 * 24 * 60 * 60 * 1000;

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

function parseSaleId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function resolveReportFullName(row: ArboxSalesReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

type ExistingContactRow = {
  id: string;
  phone?: string;
  full_name?: string | null;
  trial_registered?: boolean | null;
  session_phase?: string | null;
  opted_out?: boolean | null;
  not_relevant_at?: string | null;
  instagram_follow_prompt_sent?: boolean | null;
  arbox_user_id?: string | null;
  arbox_trial_last_notified_at?: string | null;
};

function parseMembershipTypeId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

/** Arbox salesReport `date` is day-only (YYYY-MM-DD); fall back to now. */
function parseSaleEventDate(raw: unknown): Date {
  const s = String(raw ?? "").trim();
  if (!s) return new Date();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

type OpeningTemplateDispatch = "immediate" | "deferred" | "gated" | "no_rule";

type OpeningTemplateResult =
  | { outcome: "sent" }
  | { outcome: "template_not_configured"; dispatch: OpeningTemplateDispatch }
  | { outcome: "no_matching_rule"; dispatch: "no_rule" }
  | { outcome: "deferred"; dispatch: "deferred" }
  | { outcome: "send_failed"; dispatch: OpeningTemplateDispatch };

/**
 * Out-of-window path: resolve template_triggers purchase rule →
 * delay_days=0 send immediately; delay_days>0 enqueue scheduled_template_sends.
 */
async function sendOpeningTemplateAfterTrialSaleIfConfigured(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  saleId: number;
  saleDate: unknown;
  membershipTypeId: number | null;
  phoneNumberId: string;
  fullName: string | null;
  sessionId: string | null;
}): Promise<OpeningTemplateResult> {
  const matchedRule = await resolvePurchaseTemplateTriggerForSale({
    admin: input.admin,
    businessId: input.businessId,
    membershipTypeId: input.membershipTypeId,
  });

  const templateName = matchedRule?.template_name?.trim() || null;
  let dispatch: OpeningTemplateDispatch = "no_rule";

  if (!matchedRule || !templateName) {
    console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
      matched_rule_id: matchedRule?.id ?? "none",
      template_name: templateName ?? "none",
      dispatch: "no_rule",
    });
    return { outcome: "no_matching_rule", dispatch: "no_rule" };
  }

  if (matchedRule.delay_days > 0) {
    dispatch = "deferred";
    const dueAt = computeDueAt(
      {
        delay_days: matchedRule.delay_days,
        delay_direction: delayDirectionForTrigger("purchase", matchedRule.delay_direction),
      },
      parseSaleEventDate(input.saleDate)
    );
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: matchedRule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildPurchaseScheduledDedupKey(input.businessId, matchedRule.id, input.saleId),
    });

    console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
      matched_rule_id: matchedRule.id,
      template_name: templateName,
      dispatch,
      delay_days: matchedRule.delay_days,
      delay_direction: matchedRule.delay_direction,
      due_at: dueAt.toISOString(),
      enqueue_ok: enqueueResult.ok,
      enqueue_inserted: enqueueResult.ok ? enqueueResult.inserted : false,
      enqueue_error: enqueueResult.ok ? undefined : enqueueResult.error,
    });

    if (!enqueueResult.ok) {
      return { outcome: "send_failed", dispatch: "deferred" };
    }
    return { outcome: "deferred", dispatch };
  }

  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  if (!phoneNumberId) {
    dispatch = "gated";
    console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
      matched_rule_id: matchedRule.id,
      template_name: templateName,
      dispatch,
      gate: "no_channel",
    });
    return { outcome: "template_not_configured", dispatch };
  }

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id, name").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language, components")
      .eq("business_id", input.businessId)
      .eq("name", templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
  ]);

  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!wabaId || !approvedTpl?.id) {
    dispatch = "gated";
    console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
      matched_rule_id: matchedRule.id,
      template_name: templateName,
      dispatch,
      gate: !wabaId ? "no_waba" : "template_not_approved",
    });
    return { outcome: "template_not_configured", dispatch };
  }

  dispatch = "immediate";
  const firstName = firstNameFromFullName(String(input.fullName ?? ""));
  const languageCode = String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "purchase",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
    businessId: input.businessId,
    sale_id: input.saleId,
    membership_type_id: input.membershipTypeId ?? "none",
    matched_rule_id: matchedRule.id,
    template_name: templateName,
    dispatch,
    send_ok: sendResult.ok,
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-trial-sale-registered] template send failed:", sendResult.error);
    return { outcome: "send_failed", dispatch };
  }

  if (input.sessionId) {
    await logMessage({
      business_slug: input.businessSlug,
      role: "assistant",
      content: formatLeadTemplateMessageContent(templateName, {
        firstName,
        components: storedComponents,
        bodyParams,
      }),
      model_used: LEAD_TEMPLATE_MODEL,
      session_id: input.sessionId,
    });
  }

  return { outcome: "sent" };
}

function isWithinTwoDayNotifyThrottle(lastNotifiedAtIso: string | null | undefined): boolean {
  if (!lastNotifiedAtIso) return false;
  const ts = Date.parse(lastNotifiedAtIso);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < MS_2_DAYS;
}

/**
 * רישום לשיעור ניסיון ב-Arbox (salesReport trial membership) → contact בזואי + הודעה.
 * Arbox הוא מקור האמת — לא שולח חזרה ל-CRM.
 * מכירה עם חוב פתוח לא נחשבת רישום (לינק תשלום / חשבונית) — לא מסמנים seen, כדי שתשלום מאוחר יישלח.
 */
export async function handleArboxTrialSaleRegistered(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  row: ArboxSalesReportRow;
}): Promise<ArboxTrialSaleRegisteredResult> {
  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return { ok: false, error: "invalid_business_id" };
  }
  if (!businessSlug) {
    return { ok: false, error: "missing_business_slug" };
  }

  const saleId = parseSaleId(input.row.sale_id);
  if (saleId == null) {
    return { ok: false, error: "missing_sale_id" };
  }

  if (arboxSaleHasOutstandingDebt(input.row)) {
    console.info("[leads/arbox-trial-sale-registered] skip unpaid sale", {
      businessSlug,
      sale_id: saleId,
      debt: input.row.debt ?? null,
      paid: input.row.paid ?? null,
      price: input.row.price ?? null,
      phone: maskPhoneForLog(String(input.row.phone ?? "")),
    });
    return { ok: true, unpaid: true };
  }

  const arboxUserId = String(input.row.user_id ?? "").trim();
  if (!arboxUserId) {
    return { ok: false, error: "missing_arbox_user_id" };
  }

  const fullName = resolveReportFullName(input.row);
  const membershipTypeId = parseMembershipTypeId(input.row.membership_type_id);

  // 1) Seen check — per sale
  const { data: existingSeen, error: seenErr } = await input.admin
    .from("arbox_trial_sync_log")
    .select("sale_id")
    .eq("business_id", businessId)
    .eq("sale_id", saleId)
    .maybeSingle();

  if (seenErr) {
    console.error("[leads/arbox-trial-sale-registered] seen check failed:", seenErr.message);
    return { ok: false, error: "seen_check_failed" };
  }
  if (existingSeen) {
    return { ok: true, already: true };
  }

  // 2) Contact lookup
  const contactSelect =
    "id, phone, full_name, trial_registered, session_phase, opted_out, not_relevant_at, instagram_follow_prompt_sent, arbox_user_id, arbox_trial_last_notified_at";

  let existing: ExistingContactRow | undefined;

  const { data: byArboxRows, error: byArboxErr } = await input.admin
    .from("contacts")
    .select(contactSelect)
    .eq("business_id", businessId)
    .eq("arbox_user_id", arboxUserId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (byArboxErr) {
    console.error(
      "[leads/arbox-trial-sale-registered] contact lookup by arbox_user_id failed:",
      byArboxErr.message
    );
    return { ok: false, error: "contact_lookup_failed" };
  }
  existing = byArboxRows?.[0] as ExistingContactRow | undefined;

  const phoneNorm = normalizePhone(input.row.phone);
  let matchedByPhone = false;

  if (!existing && phoneNorm) {
    const phoneVariants = contactPhoneLookupVariants(phoneNorm);
    const { data: byPhoneRows, error: byPhoneErr } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", businessId)
      .in("phone", phoneVariants.length ? phoneVariants : [phoneNorm])
      .order("updated_at", { ascending: false })
      .limit(1);

    if (byPhoneErr) {
      console.error(
        "[leads/arbox-trial-sale-registered] contact lookup by phone failed:",
        byPhoneErr.message
      );
      return { ok: false, error: "contact_lookup_failed" };
    }
    existing = byPhoneRows?.[0] as ExistingContactRow | undefined;
    matchedByPhone = Boolean(existing);
  }

  if (existing?.id) {
    const storedArboxId = String(existing.arbox_user_id ?? "").trim();
    if (storedArboxId !== arboxUserId) {
      const { error: idUpErr } = await input.admin
        .from("contacts")
        .update({ arbox_user_id: arboxUserId })
        .eq("id", existing.id);
      if (idUpErr) {
        console.warn(
          "[leads/arbox-trial-sale-registered] arbox_user_id update failed:",
          idUpErr.message
        );
      } else {
        existing.arbox_user_id = arboxUserId;
        if (matchedByPhone && storedArboxId) {
          console.info("[leads/arbox-trial-sale-registered] arbox_user_id updated from phone match", {
            businessSlug,
            phone: maskPhoneForLog(String(existing.phone ?? phoneNorm ?? "")),
            from: storedArboxId,
            to: arboxUserId,
          });
        }
      }
    }
  }

  if (!existing && !phoneNorm) {
    return { ok: false, error: "invalid_phone" };
  }

  // 3) Mark trial_registered
  const nowIso = new Date().toISOString();
  const hadNotRelevant = Boolean(existing?.not_relevant_at);
  const hadOptedOut = existing?.opted_out === true;

  const patch: Record<string, unknown> = {
    ...buildTrialRegisteredContactPatch(nowIso),
    not_relevant_at: null,
    not_relevant_reason: "",
    human_requested_at: null,
    wa_no_response_at: null,
    updated_at: nowIso,
    arbox_user_id: arboxUserId,
  };
  if (fullName) patch.full_name = fullName;

  let contactCreated = false;
  let contactId = existing?.id ? String(existing.id) : "";
  const canonicalPhone = String(existing?.phone ?? phoneNorm ?? "").trim();
  let lastNotifiedAt = existing?.arbox_trial_last_notified_at ?? null;
  const instagramFollowPromptSent = existing?.instagram_follow_prompt_sent === true;

  if (!existing) {
    const { data: inserted, error: insertErr } = await input.admin
      .from("contacts")
      .insert({
        business_id: businessId,
        phone: phoneNorm,
        full_name: fullName,
        source: "arbox_trial",
        ...patch,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error(
        "[leads/arbox-trial-sale-registered] contact insert failed:",
        insertErr?.message ?? "no_row"
      );
      return { ok: false, error: "contact_upsert_failed" };
    }
    contactId = String((inserted as { id?: string }).id ?? "").trim();
    if (!contactId) {
      return { ok: false, error: "contact_upsert_failed" };
    }
    contactCreated = true;
    lastNotifiedAt = null;
  } else {
    const { error: updateErr } = await input.admin
      .from("contacts")
      .update(patch)
      .eq("business_id", businessId)
      .eq("id", existing.id);
    if (updateErr) {
      console.error("[leads/arbox-trial-sale-registered] contact update failed:", updateErr.message);
      return { ok: false, error: "contact_upsert_failed" };
    }
  }

  if (hadNotRelevant || hadOptedOut) {
    console.info("[leads/arbox-trial-sale-registered] arbox overrode zoe status", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      had_not_relevant: hadNotRelevant,
      had_opted_out: hadOptedOut,
    });
  }

  // 4) Mark sale as seen
  const { error: seenUpsertErr } = await input.admin.from("arbox_trial_sync_log").upsert(
    {
      business_id: businessId,
      sale_id: saleId,
      contact_id: contactId,
      processed_at: nowIso,
    },
    { onConflict: "business_id,sale_id" }
  );
  if (seenUpsertErr) {
    console.error("[leads/arbox-trial-sale-registered] seen upsert failed:", seenUpsertErr.message);
    return { ok: false, error: "seen_upsert_failed" };
  }

  const channel = await resolveSendChannelForContact(input.admin, businessId, canonicalPhone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  const sessionId =
    phoneNumberId && canonicalPhone ? buildWaSessionId(phoneNumberId, canonicalPhone) : null;

  await logMessage({
    business_slug: businessSlug,
    role: "event",
    content: HEYZOE_SF_REGISTERED,
    model_used: "sf_registered_arbox_sale",
    session_id: sessionId,
  });

  // 5) Per-lead 2-day throttle (seed never sets this column)
  if (isWithinTwoDayNotifyThrottle(lastNotifiedAt)) {
    console.info("[leads/arbox-trial-sale-registered] notify throttled (2d)", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      sale_id: saleId,
    });
    return {
      ok: true,
      trial_registered_at: nowIso,
      whatsapp: "throttled_2d",
      contact_created: contactCreated,
    };
  }

  // 6) Notify: trial freeform only for trial memberships; else (and out-of-window) template path
  const { data: business } = await input.admin
    .from("businesses")
    .select("plan, arbox_trial_membership_type_ids")
    .eq("id", businessId)
    .maybeSingle();

  const trialMembershipTypeIds = (() => {
    const raw = (business as { arbox_trial_membership_type_ids?: unknown } | null)
      ?.arbox_trial_membership_type_ids;
    if (!Array.isArray(raw)) return [] as number[];
    return raw
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
  })();
  const isTrialSale =
    membershipTypeId != null && trialMembershipTypeIds.includes(membershipTypeId);

  let whatsapp:
    | "sent"
    | "no_channel"
    | "outside_24h_window"
    | "no_user_session"
    | "send_failed"
    | "template_not_configured"
    | "no_matching_rule"
    | "deferred";

  if (isTrialSale) {
    const waResult = await sendTrialRegisteredWhatsAppReplyIfInWindow({
      admin: input.admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      instagramFollowPromptSent,
      businessPlan: (business as { plan?: unknown } | null)?.plan,
    });

    if (waResult.sent) {
      whatsapp = "sent";
    } else if (waResult.reason === "send_failed") {
      whatsapp = "send_failed";
    } else {
      const templateResult = await sendOpeningTemplateAfterTrialSaleIfConfigured({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: canonicalPhone,
        saleId,
        saleDate: input.row.date,
        membershipTypeId,
        phoneNumberId,
        fullName,
        sessionId,
      });
      whatsapp = templateResult.outcome;
    }
  } else {
    // Non-trial purchase (membership/punch-card): template-only — skip trial freeform
    const templateResult = await sendOpeningTemplateAfterTrialSaleIfConfigured({
      admin: input.admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      saleId,
      saleDate: input.row.date,
      membershipTypeId,
      phoneNumberId,
      fullName,
      sessionId,
    });
    whatsapp = templateResult.outcome;
  }

  // 7) Throttle stamp only after a real notify (in-window send or out-of-window template no-op)
  if (whatsapp === "sent" || whatsapp === "template_not_configured") {
    const { error: throttleUpErr } = await input.admin
      .from("contacts")
      .update({ arbox_trial_last_notified_at: nowIso })
      .eq("id", contactId);
    if (throttleUpErr) {
      console.warn(
        "[leads/arbox-trial-sale-registered] arbox_trial_last_notified_at update failed:",
        throttleUpErr.message
      );
    }
  }

  if (whatsapp !== "sent") {
    console.info("[leads/arbox-trial-sale-registered] whatsapp outcome", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      sale_id: saleId,
      reason: whatsapp,
    });
  }

  return {
    ok: true,
    trial_registered_at: nowIso,
    whatsapp,
    contact_created: contactCreated,
  };
}
