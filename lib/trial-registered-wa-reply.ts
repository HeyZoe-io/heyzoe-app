import { fetchLastSfServiceEventName, logMessage } from "@/lib/analytics";
import { withWaMessageLogScope } from "@/lib/wa-message-log-context";
import "@/lib/wa-message-log-als.server";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import { applyDualBranchToKnowledge, fetchLastDualBranchId, isDualBranchBusiness } from "@/lib/dual-branch";
import { resolveBusinessContentLanguageFromKnowledge } from "@/lib/business-content-lang";
import { parseWaUiLang } from "@/lib/lead-ui-lang";
import { localizeKnowledgePackForLead } from "@/lib/sales-flow-localize";
import { planIsStarter } from "@/lib/conversation-quota";
import type { OfferKind } from "@/lib/sales-flow";
import {
  adaptCourseAfterRegistrationBodyForDelivery,
  defaultSalesFlowConfig,
  formatAfterRegistrationDirectionsMediaCaption,
  formatAfterTrialRegistrationForWhatsAppDelivery,
  resolveAfterRegistrationBodyTemplate,
  resolveAfterRegistrationDirectionsMediaCaptionTemplate,
  resolveAfterRegistrationDirectionsMediaEnabled,
  shouldIncludeScheduleInRegistration,
} from "@/lib/sales-flow";
import { buildWaSessionId, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  fetchLatestUserMessageAcrossChannels,
  loadActiveWaChannels,
} from "@/lib/wa-resolve-send-channel";
import { evaluateSessionMessageSend } from "@/lib/wa-marketing-opt-out";
import {
  loadTrialSignupNotice,
  stampTrialSignupNotice,
  zoeRegistrationConfirmBlockedByTrialTemplate,
} from "@/lib/trial-signup-notice";
import {
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
  sendWhatsAppMediaMessage,
  sendWhatsAppMessage,
} from "@/lib/whatsapp";

const WA_USER_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TrialRegisteredWaReplyResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "no_channel"
        | "outside_24h_window"
        | "no_user_session"
        | "send_failed"
        | "opted_out"
        | "trial_template_already_sent"
        | "empty_body";
    };

async function loadStoredTrialRegistrationBody(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<{ ok: true; direct: string; schedule: string } | { ok: false }> {
  const { data, error } = await admin
    .from("businesses")
    .select("social_links")
    .eq("id", businessId)
    .maybeSingle();
  if (error) {
    console.error("[trial-registered-wa-reply] registration body lookup failed:", error.message);
    return { ok: false };
  }
  const social =
    data && typeof (data as { social_links?: unknown }).social_links === "object"
      ? ((data as { social_links?: Record<string, unknown> }).social_links ?? {})
      : {};
  const flow =
    social.sales_flow && typeof social.sales_flow === "object"
      ? (social.sales_flow as Record<string, unknown>)
      : {};
  const direct =
    typeof flow.after_trial_registration_body === "string" ? flow.after_trial_registration_body : "";
  const schedule =
    typeof flow.after_trial_registration_body_after_schedule === "string"
      ? flow.after_trial_registration_body_after_schedule
      : "";
  return { ok: true, direct, schedule };
}

function isWithinWaUserSessionWindow(lastUserAtIso: string | null): boolean {
  if (!lastUserAtIso) return false;
  const ts = Date.parse(lastUserAtIso);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < WA_USER_SESSION_WINDOW_MS;
}

async function fetchContactScheduleSelection(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
}): Promise<{ requestedDate: string; requestedTime: string; waUiLang: string }> {
  const variants = contactPhoneLookupVariants(input.phone);
  const { data } = await input.admin
    .from("contacts")
    .select("sf_requested_date, sf_requested_time, last_contact_at, wa_ui_lang")
    .eq("business_id", input.businessId)
    .in("phone", variants.length ? variants : [input.phone]);

  const rows = (data ?? []) as Array<{
    sf_requested_date?: string | null;
    sf_requested_time?: string | null;
    last_contact_at?: string | null;
    wa_ui_lang?: string | null;
  }>;
  if (!rows.length) return { requestedDate: "", requestedTime: "", waUiLang: "" };

  const withBoth = rows.filter((row) => {
    const d = String(row.sf_requested_date ?? "").trim();
    const t = String(row.sf_requested_time ?? "").trim();
    return Boolean(d && t);
  });
  const pickFrom = withBoth.length ? withBoth : rows;
  pickFrom.sort((a, b) => {
    const ta = a.last_contact_at ? Date.parse(a.last_contact_at) : 0;
    const tb = b.last_contact_at ? Date.parse(b.last_contact_at) : 0;
    return tb - ta;
  });
  const row = pickFrom[0];
  return {
    requestedDate: String(row?.sf_requested_date ?? "").trim(),
    requestedTime: String(row?.sf_requested_time ?? "").trim(),
    waUiLang: String(row?.wa_ui_lang ?? "").trim(),
  };
}

/**
 * שולח לליד את הודעת «אחרי הרשמה» (כמו «נרשמתי» ב-webhook) — רק בתוך חלון 24 שעות מ-Meta.
 */
export async function sendTrialRegisteredWhatsAppReplyIfInWindow(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  instagramFollowPromptSent?: boolean;
  businessPlan?: unknown;
  /** Calendar booking (no sale). Forces the schedule confirmation body. */
  bookingSchedule?: { date: string; time: string; serviceName?: string };
  /**
   * Trial-booking rule only. A missing body, or one that strips to nothing,
   * returns empty_body instead of the default or the generic one-line fallback.
   */
  declineEmptyBody?: boolean;
}): Promise<TrialRegisteredWaReplyResult> {
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const businessId = Number(input.businessId);
  if (!businessSlug || !businessId) return { sent: false, reason: "no_channel" };

  const signupNotice = await loadTrialSignupNotice(input.admin, businessId, input.phone);
  if (zoeRegistrationConfirmBlockedByTrialTemplate(signupNotice)) {
    console.info("[trial-registered-wa-reply] skip, trial purchase template already sent", {
      businessSlug,
    });
    return { sent: false, reason: "trial_template_already_sent" };
  }

  const optedOut = await evaluateSessionMessageSend({
    admin: input.admin,
    businessId,
    phone: input.phone,
  });
  if (optedOut.suppress) return { sent: false, reason: "opted_out" };

  const channels = await loadActiveWaChannels(input.admin, businessId);
  const phoneNumberIds = [...new Set(channels.map((c) => c.phoneNumberId).filter(Boolean))];
  if (!phoneNumberIds.length) return { sent: false, reason: "no_channel" };

  const latestUser = await fetchLatestUserMessageAcrossChannels({
    admin: input.admin,
    businessSlug,
    phone: input.phone,
    phoneNumberIds,
  });
  if (!latestUser) return { sent: false, reason: "no_user_session" };
  if (!isWithinWaUserSessionWindow(latestUser.createdAt)) {
    return { sent: false, reason: "outside_24h_window" };
  }

  // Send on the same channel where the contact actually conversed (not first-by-id).
  const phoneNumberId = latestUser.phoneNumberId;
  const sessionId = buildWaSessionId(phoneNumberId, input.phone) || latestUser.sessionId;

  let knowledge = await getBusinessKnowledgePack(businessSlug);
  if (!knowledge) return { sent: false, reason: "send_failed" };

  const scheduleState = await fetchContactScheduleSelection({
    admin: input.admin,
    businessId,
    phone: input.phone,
  });
  const leadLang = parseWaUiLang(scheduleState.waUiLang);
  if (leadLang === "en" || leadLang === "ru") {
    knowledge = { ...knowledge };
    try {
      await localizeKnowledgePackForLead(knowledge, leadLang);
    } catch (e) {
      console.warn("[trial-registered-wa-reply] sales-flow localize failed:", e);
      knowledge.leadUiLang = leadLang;
    }
  } else if (leadLang) {
    knowledge.leadUiLang = leadLang;
  }
  const bookingDate = String(input.bookingSchedule?.date ?? "").trim();
  const bookingTime = String(input.bookingSchedule?.time ?? "").trim();
  const bookingService = String(input.bookingSchedule?.serviceName ?? "").trim();
  const requestedDate = bookingDate || scheduleState.requestedDate;
  const requestedTime = bookingTime || scheduleState.requestedTime;
  const hasScheduleSelection = Boolean(requestedDate && requestedTime);
  const bookedSlot = Boolean(bookingDate && bookingTime);

  if (isDualBranchBusiness(businessSlug)) {
    const branch = await fetchLastDualBranchId({ business_slug: businessSlug, session_id: sessionId });
    if (branch) knowledge = applyDualBranchToKnowledge(knowledge, branch);
  }

  const salesFlowServices = knowledge.salesFlowServices ?? [];
  const selectedServiceName = bookingService
    ? bookingService
    : salesFlowServices.length === 1
      ? salesFlowServices[0]!.name
      : knowledge.openingServices.length === 1
        ? knowledge.openingServices[0]!.name
        : ((await fetchLastSfServiceEventName({ business_slug: businessSlug, session_id: sessionId })) ??
          "");
  const selectedService = selectedServiceName
    ? salesFlowServices.find((s) => s.name === selectedServiceName) ?? null
    : null;
  const regOfferKind: OfferKind =
    selectedService?.offerKind ??
    knowledge.openingServices.find((s) => s.name === selectedServiceName)?.offer_kind ??
    knowledge.openingServices[0]?.offer_kind ??
    "trial";
  const serviceName =
    selectedService?.name?.trim() || selectedServiceName.trim();

  const courseDatesOff = regOfferKind === "course" && selectedService?.courseDatesEnabled === false;
  const includeScheduleInReg =
    bookedSlot ||
    shouldIncludeScheduleInRegistration({
      offerKind: regOfferKind,
      requestedDate,
      requestedTime,
      scheduleSlotCount: selectedService?.scheduleSlots?.length ?? 0,
      courseDatesEnabled: selectedService?.courseDatesEnabled,
    });
  const useScheduleRegistrationTemplate =
    bookedSlot || (knowledge.scheduleDirectRegistration === false && includeScheduleInReg);
  const sfCfg = knowledge.salesFlowConfig ?? defaultSalesFlowConfig(knowledge.vibeLabels ?? []);

  if (input.declineEmptyBody) {
    const stored = await loadStoredTrialRegistrationBody(input.admin, businessId);
    if (stored.ok && !(stored.schedule || stored.direct).trim()) {
      console.info("[trial-registered-wa-reply] empty registration body", { businessSlug });
      return { sent: false, reason: "empty_body" };
    }
  }

  let bodyTemplate = resolveAfterRegistrationBodyTemplate(
    sfCfg,
    regOfferKind,
    useScheduleRegistrationTemplate
  ).trim();
  if (!bodyTemplate && !input.declineEmptyBody) {
    bodyTemplate = resolveAfterRegistrationBodyTemplate(
      defaultSalesFlowConfig(knowledge.vibeLabels ?? []),
      regOfferKind,
      useScheduleRegistrationTemplate
    ).trim();
  }

  const hasCourseCycleDate =
    regOfferKind === "course" && !courseDatesOff && Boolean(requestedDate);
  const hasWorkshopSchedulePick =
    regOfferKind === "workshop" &&
    (Boolean(requestedDate) || Boolean(requestedTime));
  const templateWantsScheduleFields =
    bodyTemplate.includes("{requested_date}") ||
    bodyTemplate.includes("{requested_time}") ||
    bodyTemplate.includes("{course_schedule}");
  if (
    includeScheduleInReg &&
    (hasCourseCycleDate ||
      hasWorkshopSchedulePick ||
      (!useScheduleRegistrationTemplate && hasScheduleSelection && templateWantsScheduleFields))
  ) {
    const scheduleBody = resolveAfterRegistrationBodyTemplate(sfCfg, regOfferKind, true).trim();
    if (scheduleBody) bodyTemplate = scheduleBody;
  }

  const igUrlRaw = knowledge.instagramUrl?.trim() ?? "";
  const includeIgPrompt = igUrlRaw.length > 0 && !input.instagramFollowPromptSent;
  const shouldFillSchedule =
    useScheduleRegistrationTemplate ||
    hasScheduleSelection ||
    hasCourseCycleDate ||
    hasWorkshopSchedulePick ||
    bodyTemplate.includes("{requested_date}") ||
    bodyTemplate.includes("{requested_time}") ||
    bodyTemplate.includes("{course_schedule}") ||
    bodyTemplate.includes("{serviceName}") ||
    bodyTemplate.includes("(שם האימון)");

  const courseOnline = regOfferKind === "course" && selectedService?.locationMode === "online";
  const courseHasDates =
    regOfferKind === "course" &&
    selectedService?.courseDatesEnabled !== false &&
    Boolean(String(requestedDate ?? "").trim() || (selectedService?.courseCycles?.length ?? 0) > 0);
  const adaptedRegBody =
    regOfferKind === "course"
      ? adaptCourseAfterRegistrationBodyForDelivery(bodyTemplate, {
          online: courseOnline,
          hasDates: courseHasDates,
          serviceName,
        })
      : bodyTemplate;

  const regContentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
  const delivered = formatAfterTrialRegistrationForWhatsAppDelivery(
    adaptedRegBody,
    includeIgPrompt ? igUrlRaw : "",
    courseOnline ? "" : knowledge.addressText ?? "",
    courseOnline ? "" : knowledge.directionsText ?? "",
    shouldFillSchedule
      ? {
          requestedDate: includeScheduleInReg ? requestedDate : "",
          requestedTime: includeScheduleInReg ? requestedTime : "",
          serviceName,
          offerKind: regOfferKind,
          courseSchedulePhrase: undefined,
        }
      : undefined,
    regContentLang
  );
  const deliveredTrim = delivered.trim();
  if (input.declineEmptyBody && !deliveredTrim) {
    console.info("[trial-registered-wa-reply] registration body stripped empty", { businessSlug });
    return { sent: false, reason: "empty_body" };
  }
  const outTextFallback =
    regOfferKind === "workshop"
      ? "תודה על ההרשמה! נתראה בסדנה 🎉"
      : regOfferKind === "course"
        ? "תודה על ההרשמה! נתראה בקורס 🎉"
        : "תודה על ההרשמה! נתראה באימון 🎉";
  const outText = deliveredTrim.length > 0 ? delivered : outTextFallback;

  const accountSid = resolveTwilioAccountSid();
  const authToken = resolveTwilioAuthToken();
  const starterBlocksMedia = planIsStarter(input.businessPlan);

  return await withWaMessageLogScope({ businessSlug, sessionId }, async () => {
  try {
    const directionsMediaUrl = knowledge.directionsMediaUrl?.trim() ?? "";
    const sendDirectionsMedia =
      Boolean(directionsMediaUrl) &&
      resolveAfterRegistrationDirectionsMediaEnabled(sfCfg) &&
      !starterBlocksMedia &&
      !courseOnline;
    const directionsCaption = sendDirectionsMedia
      ? formatAfterRegistrationDirectionsMediaCaption(
          resolveAfterRegistrationDirectionsMediaCaptionTemplate(sfCfg, regContentLang),
          knowledge.addressText ?? "",
          knowledge.directionsText ?? "",
          regContentLang
        )
      : "";
    if (sendDirectionsMedia) {
      await sendWhatsAppMediaMessage(
        phoneNumberId,
        input.phone,
        directionsMediaUrl,
        accountSid,
        authToken,
        directionsCaption || undefined,
        knowledge.directionsMediaType === "video"
          ? "video"
          : knowledge.directionsMediaType === "image"
            ? "image"
            : undefined
      );
      await logMessage({
        business_slug: businessSlug,
        role: "assistant",
        content: `[media] ${directionsMediaUrl}${directionsCaption ? `\n\n${directionsCaption}` : ""}`,
        model_used: "directions_media",
        session_id: sessionId,
      });
    }

    await sendWhatsAppMessage(phoneNumberId, input.phone, outText, accountSid, authToken);
    await stampTrialSignupNotice(input.admin, businessId, input.phone, "zoe");
    await logMessage({
      business_slug: businessSlug,
      role: "assistant",
      content: outText,
      model_used: "sales_flow_after_trial_registered",
      session_id: sessionId,
    });

    if (includeIgPrompt) {
      const variants = contactPhoneLookupVariants(input.phone);
      await input.admin
        .from("contacts")
        .update({ instagram_follow_prompt_sent: true })
        .eq("business_id", businessId)
        .in("phone", variants.length ? variants : [input.phone]);
    }

    return { sent: true };
  } catch (e) {
    console.error("[trial-registered-wa-reply] send failed:", {
      businessSlug,
      phone: input.phone.slice(-4),
      error: e instanceof Error ? e.message : String(e),
    });
    return { sent: false, reason: "send_failed" };
  }
  });
}
