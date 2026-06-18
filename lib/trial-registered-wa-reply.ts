import { HEYZOE_SF_REGISTERED, fetchLastSfServiceEventName, logMessage } from "@/lib/analytics";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import { resolveBusinessContentLanguageFromKnowledge } from "@/lib/business-content-lang";
import { planIsStarter } from "@/lib/conversation-quota";
import type { OfferKind } from "@/lib/sales-flow";
import {
  defaultSalesFlowConfig,
  formatAfterTrialRegistrationForWhatsAppDelivery,
  resolveAfterRegistrationBodyTemplate,
} from "@/lib/sales-flow";
import {
  buildWaSessionId,
  contactPhoneLookupVariants,
  waSessionIdLookupVariants,
} from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
  sendWhatsAppMediaMessage,
  sendWhatsAppMessage,
} from "@/lib/whatsapp";

const WA_USER_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TrialRegisteredWaReplyResult =
  | { sent: true }
  | { sent: false; reason: "no_channel" | "outside_24h_window" | "no_user_session" | "send_failed" };

async function fetchLatestUserMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessSlug: string;
  sessionIds: string[];
}): Promise<string | null> {
  const sessionIds = input.sessionIds.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data } = await input.admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", input.businessSlug)
    .in("session_id", sessionIds)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = String((data as { created_at?: string } | null)?.created_at ?? "").trim();
  return at || null;
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
}): Promise<{ requestedDate: string; requestedTime: string }> {
  const variants = contactPhoneLookupVariants(input.phone);
  const { data } = await input.admin
    .from("contacts")
    .select("sf_requested_date, sf_requested_time, last_contact_at")
    .eq("business_id", input.businessId)
    .in("phone", variants.length ? variants : [input.phone]);

  const rows = (data ?? []) as Array<{
    sf_requested_date?: string | null;
    sf_requested_time?: string | null;
    last_contact_at?: string | null;
  }>;
  if (!rows.length) return { requestedDate: "", requestedTime: "" };

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
}): Promise<TrialRegisteredWaReplyResult> {
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const businessId = Number(input.businessId);
  if (!businessSlug || !businessId) return { sent: false, reason: "no_channel" };

  const { data: channel } = await input.admin
    .from("whatsapp_channels")
    .select("phone_number_id")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  const phoneNumberId = String((channel as { phone_number_id?: string } | null)?.phone_number_id ?? "").trim();
  if (!phoneNumberId) return { sent: false, reason: "no_channel" };

  const sessionId = buildWaSessionId(phoneNumberId, input.phone);
  const sessionIds = waSessionIdLookupVariants(phoneNumberId, input.phone);
  const lastUserAtIso = await fetchLatestUserMessageAt({
    admin: input.admin,
    businessSlug,
    sessionIds,
  });
  if (!lastUserAtIso) return { sent: false, reason: "no_user_session" };
  if (!isWithinWaUserSessionWindow(lastUserAtIso)) {
    return { sent: false, reason: "outside_24h_window" };
  }

  const knowledge = await getBusinessKnowledgePack(businessSlug);
  if (!knowledge) return { sent: false, reason: "send_failed" };

  const scheduleState = await fetchContactScheduleSelection({
    admin: input.admin,
    businessId,
    phone: input.phone,
  });
  const requestedDate = scheduleState.requestedDate;
  const requestedTime = scheduleState.requestedTime;
  const hasScheduleSelection = Boolean(requestedDate && requestedTime);

  const selectedServiceName =
    knowledge.openingServices.length === 1
      ? knowledge.openingServices[0]!.name
      : (await fetchLastSfServiceEventName({ business_slug: businessSlug, session_id: sessionId })) ?? "";
  const selectedService =
    knowledge.openingServices.find((s) => s.name === selectedServiceName) ??
    knowledge.openingServices[0] ??
    null;
  const regOfferKind: OfferKind = selectedService?.offer_kind ?? "trial";
  const regServiceFallback =
    regOfferKind === "workshop" ? "הסדנה" : regOfferKind === "course" ? "הקורס" : "האימון";
  const serviceName =
    selectedService?.name?.trim() || selectedServiceName.trim() || regServiceFallback;

  const useScheduleRegistrationTemplate = knowledge.scheduleDirectRegistration === false;
  const sfCfg = knowledge.salesFlowConfig ?? defaultSalesFlowConfig(knowledge.vibeLabels ?? []);

  let bodyTemplate = resolveAfterRegistrationBodyTemplate(
    sfCfg,
    regOfferKind,
    useScheduleRegistrationTemplate
  ).trim();
  if (!bodyTemplate) {
    bodyTemplate = resolveAfterRegistrationBodyTemplate(
      defaultSalesFlowConfig(knowledge.vibeLabels ?? []),
      regOfferKind,
      useScheduleRegistrationTemplate
    ).trim();
  }

  const hasCourseCycleDate = regOfferKind === "course" && Boolean(requestedDate);
  const hasWorkshopSchedulePick =
    regOfferKind === "workshop" &&
    (Boolean(requestedDate) || Boolean(requestedTime));
  const templateWantsScheduleFields =
    bodyTemplate.includes("{requested_date}") ||
    bodyTemplate.includes("{requested_time}") ||
    bodyTemplate.includes("{course_schedule}");
  if (
    hasCourseCycleDate ||
    hasWorkshopSchedulePick ||
    (!useScheduleRegistrationTemplate && hasScheduleSelection && templateWantsScheduleFields)
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

  const regContentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
  const delivered = formatAfterTrialRegistrationForWhatsAppDelivery(
    bodyTemplate,
    includeIgPrompt ? igUrlRaw : "",
    knowledge.addressText ?? "",
    knowledge.directionsText ?? "",
    shouldFillSchedule
      ? {
          requestedDate,
          requestedTime,
          serviceName,
          offerKind: regOfferKind,
          courseSchedulePhrase: undefined,
        }
      : undefined,
    regContentLang
  );
  const outTextFallback =
    regOfferKind === "workshop"
      ? "תודה על ההרשמה! נתראה בסדנה 🎉"
      : regOfferKind === "course"
        ? "תודה על ההרשמה! נתראה בקורס 🎉"
        : "תודה על ההרשמה! נתראה באימון 🎉";
  const outText = delivered.trim().length > 0 ? delivered : outTextFallback;

  const accountSid = resolveTwilioAccountSid();
  const authToken = resolveTwilioAuthToken();
  const starterBlocksMedia = planIsStarter(input.businessPlan);

  try {
    const directionsMediaUrl = knowledge.directionsMediaUrl?.trim() ?? "";
    const directionsCaption = [
      knowledge.addressText?.trim() ? `הכתובת שלנו:\n${knowledge.addressText.trim()}` : "",
      knowledge.directionsText?.trim() ? `ככה מגיעים אלינו:\n${knowledge.directionsText.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (directionsMediaUrl && !starterBlocksMedia) {
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
}
