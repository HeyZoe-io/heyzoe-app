import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  verifyTwilioSignature,
  parseTwilioWebhook,
  parseMetaWebhook,
  explainMetaWebhookSkip,
  sendWhatsAppMessage,
  sendWhatsAppTextOrMenu,
  sendWhatsAppMediaMessage,
  resolveMetaInteractiveLabel,
  metaInteractiveDecodeReplyId,
  stripNumberedChoiceLinesAnywhere,
  stripTrailingNumberedChoiceLines,
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
  resolveMetaAppSecret,
  resolveMetaVerifyToken,
  verifyMetaSignature256,
  isMetaCloudPhoneNumberId,
  resolveMetaAccessToken,
  type WaIncomingMessage,
  type WaIncomingText,
  WA_UNSUPPORTED_INBOUND_MODEL,
  WA_UNSUPPORTED_INBOUND_REPLY,
} from "@/lib/whatsapp";
import { getBusinessKnowledgePack, buildSystemPrompt, type BusinessKnowledgePack } from "@/lib/business-context";
import { type SfServiceRow } from "@/lib/sf-service-rows";
import { loadZoePlatformGuidelines } from "@/lib/business-zoe-platform";
import { getWhatsAppOpeningBodyAndMenuLabels } from "@/lib/whatsapp-opening";
import {
  BUSINESS_INACTIVE_AUTO_REPLY_MODEL,
  buildInactiveBusinessAutoReply,
  customerServicePhoneFromSocialLinks,
  getZoeWhatsAppMenuFooter,
} from "@/lib/whatsapp-copy";
import {
  contactPhoneLookupVariants,
  buildWaSessionId,
  normalizePhone,
  waSessionPhoneKey,
} from "@/lib/phone-normalize";
import { buildTrialRegisteredContactPatch } from "@/lib/trial-registered-manual";
import {
  composeGreeting,
  defaultSalesFlowConfig,
  appendTrialPromotionToCtaBody,
  fillAfterExperienceTemplate,
  fillAfterServicePickTemplate,
  fillCtaBodyTemplate,
  fillOfferKindCtaBody,
  formatAfterTrialRegistrationForWhatsAppDelivery,
  ctaButtonsForOfferKind,
  filterTrialCtaButtonsAfterSchedule,
  getEffectiveFollowupMenuLabels,
  getEffectiveSalesFlowCtaButtons,
  getEffectiveSecondaryOfferCtaButtons,
  matchesTrialAlreadyRegisteredMessage,
  matchesTrialRegisteredMessage,
  offerKindFromServiceMeta,
  resolveTrialCtaBodyTemplate,
  resolveSfServicePriceDuration,
  resolveAfterRegistrationBodyTemplate,
  isWarmupExperienceQuestion1Configured,
  buildWarmupExtraCleanStepsFromWb,
  resolveWarmupExperienceConfig,
  resolveWarmupExperienceReply,
  fillAfterCourseCyclePickTemplate,
  fillAfterScheduleSelectionTemplate,
  resolveAfterScheduleSelectionTemplate,
  resolveCourseCyclePickQuestion,
  buildDefaultMultiServiceQuestion,
  buildScheduleSlotPickQuestion,
  DEFAULT_MULTI_SERVICE_QUESTION_TAIL,
  resolveScheduleBoardAssets,
  SCHEDULE_BOARD_CAPTION,
  splitMultiServiceQuestionForWhatsApp,
  stripScheduleLineFromMultiServiceQuestion,
  type ScheduleBoardAssets,
  type EffectiveSalesFlowCtaInput,
} from "@/lib/sales-flow";
import {
  shouldResetWaFollowupCycleOnInbound,
  WA_FOLLOWUP_CYCLE_RESET_PATCH,
} from "@/lib/wa-followup-cycle-reset";
import {
  ensureRegisteredOpenQuestionClosing,
  stripMenuEchoFromAnswer,
  stripTrailingFollowUpQuestion,
} from "@/lib/wa-split-answer";
import {
  assistantAwaitingServiceRepickPick,
  ensureCtaServiceRepickBridge,
  fetchLastAssistantMessageContent,
  isCtaServiceFitQuestion,
  isExplicitOtherServiceRequest,
  isNumericServicePickReply,
  isPhaseAgnosticExplicitServiceSwitch,
  replyContainsServiceRepickBridge,
  resolveImplicitServiceSwitchFromFreeText,
  SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE,
  shouldHandleCtaServiceRepickYes,
} from "@/lib/wa-cta-service-repick";
import { truncateWaButtonLabel } from "@/lib/wa-button-label";
import {
  buildWarmupExperienceMenu,
  isWarmupExperienceQuestionPending,
  stripPendingWarmupMenuFromAnswer,
  wasWarmupExperienceQuestionSentSinceReset,
  WA_WARMUP_EXPERIENCE_SENT_MODEL,
} from "@/lib/wa-warmup-pending";
import {
  replyRefersToCustomerService,
  sendCustomerServiceRedirectWithServicePickFollowUp,
} from "@/lib/wa-cs-redirect-service-pick";
import {
  buildSalesFlowHumanAgentHandoffReply,
  userRequestedHumanAgent,
} from "@/lib/notifications/detect-human-request";
import {
  applyKnownAssistantReplyFixes,
  buildPickedServiceScheduleLexiconForPrompt,
  getScheduleDayLabelsFromSlots,
} from "@/lib/wa-assistant-reply-fixes";
import {
  isMetaInteractiveMenuReply,
  isSalesFlowFreeTextInbound,
  isSalesFlowStartInbound,
  shouldResendDeterministicMenuOnUnrecognizedPick,
} from "@/lib/sales-flow-inbound";
import { normalizeSalesFlowGreetingToken, isSalesFlowStartTrigger } from "@/lib/sales-flow-start-triggers";
import { isScheduleIntent } from "@/lib/wa-schedule-intent";
import { isJoinSignupIntentText, isWarmupSkipIntentText } from "@/lib/wa-warmup-skip-intent";
import { decideWarmupExtraResendAction } from "@/lib/wa-warmup-extra-resend";
import {
  salesFlowOpeningResetPatch,
  withWarmupExtraAwaitingOff,
  WARMUP_EXTRA_AWAITING_OFF,
} from "@/lib/wa-warmup-awaiting-idx";
import {
  rollbackWarmupAwaitingAfterSendFailure,
  tryAdvanceWarmupAwaitingIdx,
  tryAdvanceWarmupAwaitingOnPick,
  tryClaimWarmupAwaitingSend,
} from "@/lib/wa-warmup-awaiting-cas";
import { fetchPhoneNumbersForWaba, subscribeWabaToAppWebhooks } from "@/lib/meta-waba-resolve";
import {
  addressDirectionsPrefix,
  addressMissingMessage,
  addressOurPrefix,
  ctaOpenQuestionNote,
  formatAddressReplyLines,
  instagramFollowLine,
  registeredFlowContinuationClosing,
  resolveBusinessContentLanguageFromKnowledge,
  trialAlreadyRegisteredSoftClosing,
  trialAlreadyRegisteredSoftIntro,
  trialLinkPostCtaMessage,
  trialSignupLinkIntro,
  trialSignupLinkMissing,
} from "@/lib/business-content-lang";

/** אחרי קישור תשלום לסדנה / קורס (לא אימון ניסיון). */
const SECONDARY_OFFER_PURCHASE_POST_CTA_MESSAGE =
  "לאחר התשלום כתבו *נרשמתי* ואשלח לכם את כל הפרטים!";
const GEMINI_WHATSAPP_MODEL = "gemini-2.5-flash" as const;

function salesFlowMenuFooter(knowledge: BusinessKnowledgePack | null | undefined): string {
  return getZoeWhatsAppMenuFooter(resolveBusinessContentLanguageFromKnowledge(knowledge));
}

function stripZoeMenuFooterFromText(text: string): string {
  let t = text;
  t = t.replaceAll(getZoeWhatsAppMenuFooter("he"), "");
  t = t.replaceAll(getZoeWhatsAppMenuFooter("en"), "");
  return t.replace(/\n{3,}/g, "\n\n");
}

function formatInteractiveConversationLog(
  body: string,
  labels: string[],
  footerHint = getZoeWhatsAppMenuFooter()
): string {
  const cleanLabels = labels.map((label) => String(label ?? "").trim()).filter(Boolean);
  return [
    String(body ?? "").trim(),
    cleanLabels.length > 0 ? `[כפתורים: ${cleanLabels.join(" | ")}]` : "",
    String(footerHint ?? "").trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** מסיר שורת לוג פנימית שהמודל לעיתים מעתיק לתשובה ללקוח. */
function stripAssistantInteractiveButtonsLog(text: string): string {
  return String(text ?? "")
    .replace(/\n?\[כפתורים:\s*[^\]]+\]\s*/gu, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isWaInboundTextMessage(msg: WaIncomingMessage): msg is WaIncomingText {
  return msg.type === "text";
}

/** list_reply / button_reply חייבים להיפתר בנתיב דטרמיניסטי — לא ב-Claude. */
function warnInteractiveReplyRoutedToClaude(input: {
  business_slug: string;
  sessionId: string;
  msg: WaIncomingText;
  sessionPhase: HeyzoeSessionPhase;
  isFreeTextSalesFlowAi: boolean;
}): void {
  console.warn("[WA Webhook] INVARIANT_VIOLATION: interactive reply routed to Claude free-text path", {
    business_slug: input.business_slug,
    session_id: input.sessionId,
    session_phase: input.sessionPhase,
    interactive_kind: input.msg.metaInteractiveReplyKind ?? "unknown",
    meta_reply_id: input.msg.metaInteractiveReplyId ?? "",
    text: input.msg.text,
    from: input.msg.from,
    is_free_text_sales_flow: input.isFreeTextSalesFlowAi,
  });
}
import {
  CLAUDE_WHATSAPP_MODEL,
  CLAUDE_WHATSAPP_MAX_TOKENS,
  resolveClaudeApiKey,
  formatUserFacingClaudeError,
  isRetryableClaudeError,
  sleepMs,
} from "@/lib/claude";
import {
  extractErrorCode,
  fetchLastAssistantModelUsed,
  fetchLastSfServiceEventName,
  fetchLastSfWarmupExtraIndex,
  fetchRecentSessionMessages,
  HEYZOE_SF_CTA_REACHED,
  HEYZOE_SF_REGISTERED,
  HEYZOE_SF_SERVICE_PREFIX,
  HEYZOE_SF_WARMUP_EXTRA_PREFIX,
  logMessage,
} from "@/lib/analytics";
import {
  buildCourseScheduleInfoMessage,
  buildCourseSchedulePhraseForCtaFromPick,
  findCourseCycleByDisplayStartDate,
  formatCycleSlotsPhrase,
  buildCourseSchedulePhraseForCta,
  resolveCourseScheduleDayHourForCta,
  courseCycleStartButtonLabelsMatch,
  courseCyclesForStartButtons,
  courseHasCycleSchedulePickData,
  formatCourseCycleStartButtonLabel,
  formatCycleDateShort,
  formatSlotPickButtonLabelWithCycle,
  formatDayNameForScheduleDatePlaceholder,
  formatYomForContactSlotDate,
  migrateLegacyCourseToCycles,
  resolveWaSchedulePickSlotsFromMeta,
  scheduleSlotPickLabelsMatch,
  syncCourseLegacyDatesFromCycles,
  type CourseCycle,
  type WaSchedulePickSlot,
} from "@/lib/product-schedule-slots";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { handleMonthlyConversationQuota, planIsStarter } from "@/lib/conversation-quota";
import {
  assistantReplyIndicatesLeadNotRelevant,
  classifyNotRelevantIntentWithClaude,
  handleLeadNotRelevant,
  matchesNotRelevantKeyword,
  NOT_RELEVANT_REPLY_MESSAGE,
  reactivateNotRelevantLead,
} from "@/lib/not-relevant";
import { buildNoResponseReactivationPatch } from "@/lib/wa-no-response";
import {
  acquireContactProcessingLock,
  releaseContactProcessingLock,
} from "@/lib/wa-contact-processing-lock";

export const runtime = "nodejs";
/** Below CONTACT_PROCESSING_LOCK_TTL_SECONDS (60s) so Vercel kills stuck handlers before lock expires. */
export const maxDuration = 55;

// In-process dedup: fast path that prevents double-processing on the same instance.
const processedMessageIds = new Set<string>();

/**
 * Dedup עמיד בין אינסטנסים: Vercel לא חולק זיכרון, ו-retry של Meta/Twilio (כש-Claude
 * איטי וה-webhook לא חזר 200 בזמן) מגיע לאינסטנס אחר ומעבד את אותה הודעה שוב → שתי
 * תשובות. כאן עושים INSERT אטומי לפי message_id; conflict = כפילות → לא לעבד שוב.
 * מחזיר true אם ההודעה "נתפסה" לעיבוד (להמשיך), false אם כבר עובדה (לדלג).
 * fail-open: אם הטבלה חסרה / שגיאה לא צפויה — מעבדים (עדיף כפילות נדירה מאשר לאבד הודעה).
 */
async function claimMessageForProcessing(messageId: string): Promise<boolean> {
  if (!messageId) return true;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("wa_processed_messages")
      .insert({ message_id: messageId });
    if (!error) {
      // ניקוי best-effort של רשומות ישנות (לא בכל הודעה — אחת ל-~50, IO זניח)
      if (Math.random() < 0.02) {
        const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        await admin
          .from("wa_processed_messages")
          .delete()
          .lt("processed_at", cutoff)
          .then(undefined, () => {});
      }
      return true;
    }
    if (error.code === "23505") {
      console.info(`[WA Webhook] Skipping duplicate (durable) ${messageId}`);
      return false;
    }
    if (/wa_processed_messages|relation|does not exist|schema cache/i.test(error.message)) {
      console.warn("[WA Webhook] durable dedup unavailable, falling back to in-memory:", error.message);
      return true;
    }
    console.error("[WA Webhook] durable dedup insert error:", error.message);
    return true;
  } catch (e) {
    console.error("[WA Webhook] durable dedup exception:", e);
    return true;
  }
}

function waNormLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function classifyOptOutWithClaude(input: { apiKey: string; text: string }): Promise<boolean> {
  const apiKey = input.apiKey.trim();
  const text = input.text.trim();
  if (!apiKey || !text) return false;
  if (text.length > 800) return false;
  try {
    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: CLAUDE_WHATSAPP_MODEL,
      max_tokens: 12,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `האם המשפט הבא מביע רצון להפסיק לקבל הודעות (הסרה מרשימת דיוור) — ולא רק שאינו מעוניין בשירות?\nענה רק "כן" או "לא".\nמשפט: "${text}"`,
        },
      ],
    });
    const out = (resp.content ?? [])
      .map((c) => ("text" in c ? String((c as any).text ?? "") : ""))
      .join("\n")
      .trim()
      .toLowerCase();
    return out.startsWith("כן");
  } catch (e) {
    console.warn("[WA Webhook] opt-out Claude classify failed (continuing):", e);
    return false;
  }
}

const SALES_FLOW_START_INTENT_START = "START_SALES_FLOW";
const SALES_FLOW_START_INTENT_NO = "NO";

/** כוונה להתחיל פלואו מכירה (לא שאלה פתוחה ספציפית). */
async function classifySalesFlowStartIntentWithClaude(input: { apiKey: string; text: string }): Promise<boolean> {
  const apiKey = input.apiKey.trim();
  const text = input.text.trim();
  if (!apiKey || !text) return false;
  if (text.length > 800) return false;
  try {
    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: CLAUDE_WHATSAPP_MODEL,
      max_tokens: 16,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `האם המשפט מביע כוונה להתחיל שיחת מכירה / לקבל פרטים כלליים על הסטודיו, שיעורים או הצטרפות — ולא שאלה נקודתית על מחיר, מיקום או פרט יחיד?

ענה רק "${SALES_FLOW_START_INTENT_START}" או "${SALES_FLOW_START_INTENT_NO}" (בדיוק, בלי טקסט נוסף).

דוגמאות ל-${SALES_FLOW_START_INTENT_START}: בואו נתחיל, אשמח לפרטים, היי אשמח לפרטים, רוצה להצטרף, מה יש אצלכם, ספרו לי עליכם, אשמח לשמוע פרטים
דוגמאות ל-${SALES_FLOW_START_INTENT_NO}: מה המחיר בדיוק, איפה אתם, כמה עולה אימון ביום שלישי, האם יש חניה

משפט: "${text}"`,
        },
      ],
    });
    const out = (resp.content ?? [])
      .map((c) => ("text" in c ? String((c as { text?: string }).text ?? "") : ""))
      .join("\n")
      .trim()
      .toUpperCase();
    if (out.includes(SALES_FLOW_START_INTENT_NO)) return false;
    return out.includes(SALES_FLOW_START_INTENT_START);
  } catch (e) {
    console.warn("[WA Webhook] sales-flow start intent classify failed (continuing):", e);
    return false;
  }
}

function normalizeGreetingToken(s: string): string {
  return normalizeSalesFlowGreetingToken(s);
}

function isSalesFlowGreetingTrigger(text: string): boolean {
  return isSalesFlowStartTrigger(text);
}

function resolveWaMenuChoice(
  raw: string,
  metaInteractiveReplyId: string | undefined,
  candidates: string[],
  /** לתשובה מספרית בלבד — מניעת בלבול בין תפריט ראשי לתפריט המשך */
  numericScope?: string[]
): string {
  const trimmed = raw.trim();
  if (/^[1-9]$/.test(trimmed) && numericScope && numericScope.length) {
    const idx = Number(trimmed);
    if (idx >= 1 && idx <= numericScope.length) return numericScope[idx - 1]!;
  }
  const base = metaInteractiveReplyId?.trim()
    ? resolveMetaInteractiveLabel(metaInteractiveReplyId, raw, candidates)
    : raw.trim();
  let label = base.trim();
  const n = waNormLabel(label);
  const asNum = Number(n);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= candidates.length) {
    label = candidates[asNum - 1] ?? label;
  }
  return label;
}

function waLabelMatches(a: string, b: string): boolean {
  return waNormLabel(a) === waNormLabel(b);
}

/** מיפוי תשובת כפתור/רשימה ל־index — כולל התאמה אחרי חיתוך תוויות לוואטסאפ (23 תווים). */
function findWaMenuOptionIndex(
  raw: string,
  metaInteractiveReplyId: string | undefined,
  candidates: string[]
): number {
  if (!candidates.length) return -1;
  const incomingResolved = resolveWaMenuChoice(raw, metaInteractiveReplyId, candidates);
  let idx = candidates.findIndex((o) => waLabelMatches(incomingResolved, o));
  if (idx >= 0) return idx;
  idx = candidates.findIndex((o) => waLabelMatches(incomingResolved, truncateWaButtonLabel(o)));
  if (idx >= 0) return idx;
  const truncatedIncoming = truncateWaButtonLabel(incomingResolved);
  if (truncatedIncoming) {
    idx = candidates.findIndex((o) => waLabelMatches(truncatedIncoming, truncateWaButtonLabel(o)));
  }
  return idx;
}

function isAddressOrDirectionsIntent(text: string): boolean {
  const normalized = normalizeGreetingToken(text);
  return (
    normalized.includes("מה הכתובת") ||
    normalized.includes("כתובת") ||
    normalized.includes("איפה זה") ||
    normalized.includes("איפה אתם") ||
    normalized.includes("איפה נמצא") ||
    normalized.includes("מיקום") ||
    normalized.includes("איך מגיעים") ||
    normalized.includes("איך להגיע") ||
    normalized.includes("הנחיות הגעה") ||
    normalized.includes("דרכי הגעה") ||
    normalized.includes("איך באים") ||
    normalized.includes("איך מגיעה") ||
    normalized.includes("whats the address") ||
    normalized.includes("what is the address") ||
    normalized.includes("where are you located") ||
    normalized.includes("where are you") ||
    normalized.includes("where is the studio") ||
    normalized.includes("your address") ||
    normalized.includes("your location") ||
    normalized.includes("how do i get there") ||
    normalized.includes("directions") ||
    normalized.includes("how to get to you") ||
    normalized.includes("where to find you")
  );
}

type HeyzoeSessionPhase = "opening" | "warmup" | "schedule_date" | "schedule_time" | "cta" | "registered";

/** שלבים שאחרי תשובת Claude לטקסט חופשי שולחים מחדש את השאלה/תפריט הפתוח (לא CTA/registered). */
const SALES_FLOW_FREE_TEXT_SPLIT_PHASES = new Set<HeyzoeSessionPhase>([
  "opening",
  "warmup",
  "schedule_date",
  "schedule_time",
]);

const WARMUP_EXTRA_MENU_MODELS = new Set([
  "sales_flow_warmup_extra",
  "flow_continuation_warmup_extra",
]);

function isWarmupExtraMenuModel(model: string | null | undefined): boolean {
  return WARMUP_EXTRA_MENU_MODELS.has(String(model ?? "").trim());
}

/** בחירת שירות מרובה — רק בשלב opening (לא בתוך חימום / לוח / CTA). */
function isSalesFlowMultiServicePickPhase(phase: HeyzoeSessionPhase): boolean {
  return phase === "opening";
}

function inferWarmupExtraStepIndex(input: {
  flowStep: number;
  hasWarmupQ1: boolean;
  cleanStepsCount: number;
  lastIdxFromEvent: number | null;
  lastAssistModel: string | null;
  sessionPhase?: HeyzoeSessionPhase;
}): number | null {
  if (input.lastIdxFromEvent != null) return input.lastIdxFromEvent;
  const canInferFromFlowStep =
    isWarmupExtraMenuModel(input.lastAssistModel) || input.sessionPhase === "warmup";
  if (!canInferFromFlowStep || input.cleanStepsCount < 1) return null;
  const base = input.hasWarmupQ1 ? 1 : 0;
  const bumpedIdx = input.flowStep - base - 1;
  if (bumpedIdx >= 0 && bumpedIdx < input.cleanStepsCount) return bumpedIdx;
  const unbumpedIdx = input.flowStep - base;
  if (unbumpedIdx >= 0 && unbumpedIdx < input.cleanStepsCount) return unbumpedIdx;
  return input.cleanStepsCount === 1 ? 0 : null;
}

function normalizeSessionPhase(raw: unknown): HeyzoeSessionPhase {
  const s = String(raw ?? "").trim();
  if (
    s === "warmup" ||
    s === "schedule_date" ||
    s === "schedule_time" ||
    s === "cta" ||
    s === "registered" ||
    s === "opening"
  ) return s;
  return "opening";
}

/** שלבי פלואו דטרמיניסטי — שאלות פתוחות במהלכם ממשיכות מאותו שלב (לא קופצות ל-CTA). */
const SALES_FLOW_DETERMINISTIC_PHASES = new Set<HeyzoeSessionPhase>([
  "opening",
  "warmup",
  "schedule_date",
  "schedule_time",
]);

const CTA_MENU_SENT_MODELS = new Set([
  "sales_flow_cta",
  "sf_cta_reached",
  "sf_recover_to_cta",
  "flow_continuation_cta",
]);

function isAiFreeTextAssistantModel(model: string | null | undefined): boolean {
  const m = String(model ?? "").trim();
  return m === CLAUDE_WHATSAPP_MODEL || m === GEMINI_WHATSAPP_MODEL;
}

type JoinSignupRecoveryAction = "none" | "service_pick" | "cta_menu";

async function resolveJoinSignupRecoveryAction(input: {
  business_slug: string;
  session_id: string;
  phase: HeyzoeSessionPhase;
  isJoinSignupIntent: boolean;
  isFreeTextSalesFlowAi: boolean;
  multiService: boolean;
  lastPickedServiceName: string | null;
}): Promise<JoinSignupRecoveryAction> {
  if (!input.isJoinSignupIntent || !input.isFreeTextSalesFlowAi) return "none";
  if (input.phase === "registered") return "none";
  if (SALES_FLOW_DETERMINISTIC_PHASES.has(input.phase)) return "none";

  const lastModel = await fetchLastAssistantModelUsed({
    business_slug: input.business_slug,
    session_id: input.session_id,
  });
  const driftedToAi = isAiFreeTextAssistantModel(lastModel);

  if (!driftedToAi && input.phase !== "cta") return "none";

  if (input.multiService && !input.lastPickedServiceName?.trim()) {
    return "service_pick";
  }

  if (input.phase !== "cta") return "none";
  if (lastModel && CTA_MENU_SENT_MODELS.has(lastModel)) return "none";

  return "cta_menu";
}

async function updateContactSessionPhase(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  phone: string;
  phase: HeyzoeSessionPhase;
}): Promise<void> {
  const { supabase, businessId, phone, phase } = input;
  const phoneVariants = contactPhoneLookupVariants(phone);
  try {
    const { error } = await supabase
      .from("contacts")
      .update(withWarmupExtraAwaitingOff({ session_phase: phase, flow_step: 0 }))
      .eq("business_id", businessId)
      .in("phone", phoneVariants.length ? phoneVariants : [phone]);
    if (error) console.warn("[WA Webhook] session_phase update failed:", error.message);
  } catch (e) {
    console.warn("[WA Webhook] session_phase update threw:", e);
  }
}

/** חלון שבו «נרשמתי» חוזר נחשב לחיצה כפולה (לא המרה חדשה). */
const TRIAL_REGISTRATION_REPEAT_WINDOW_MS = 48 * 60 * 60 * 1000;

function shouldAckRepeatTrialRegistration(input: {
  trialRegistered: boolean;
  trialRegisteredAt: string | null;
  sessionPhase: HeyzoeSessionPhase;
}): boolean {
  if (!input.trialRegistered || input.sessionPhase !== "registered") return false;
  if (!input.trialRegisteredAt) return true;
  const ageMs = Date.now() - new Date(input.trialRegisteredAt).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < TRIAL_REGISTRATION_REPEAT_WINDOW_MS;
}

/** איפוס מצב פלואו/CTA ב«היי» — מאפס trial_registered לסשן חדש; היסטוריית HEYZOE_SF_REGISTERED נשמרת ב-messages. */
async function resetContactSalesFlowStateForGreeting(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  phone: string;
}): Promise<void> {
  const { supabase, businessId, phone } = input;
  const phoneVariants = contactPhoneLookupVariants(phone);
  try {
    const { error } = await supabase
      .from("contacts")
      .update({
        sf_clicked_cta_kinds: [],
        sf_requested_date: null,
        sf_requested_time: null,
        instagram_follow_prompt_sent: false,
        flow_step: 0,
        warmup_extra_awaiting_idx: WARMUP_EXTRA_AWAITING_OFF,
        trial_registered: false,
        trial_registered_at: null,
      })
      .eq("business_id", businessId)
      .in("phone", phoneVariants.length ? phoneVariants : [phone]);
    if (error) console.warn("[WA Webhook] sales flow greeting reset failed:", error.message);
  } catch (e) {
    console.warn("[WA Webhook] sales flow greeting reset threw:", e);
  }
}

type RestartSalesFlowFromGreetingResult = {
  ranContinuation: boolean;
  contactSessionPhase: HeyzoeSessionPhase;
  contactFlowStep: number;
  sfClickedCtaKinds: string[];
  contactInstagramFollowPromptSent: boolean;
  contactTrialRegistered: boolean;
  contactTrialRegisteredAt: string | null;
  allowTrialCtaThisSession: boolean;
};

/** איפוס + פתיחה + המשך פלואו מכירה (כמו טריגר «היי» / כוונת התחלה). */
async function restartSalesFlowFromGreeting(input: {
  knowledge: BusinessKnowledgePack | null;
  salesFlowServices: SfServiceRow[];
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string | null;
  business_slug: string;
  sessionId: string;
  blockTrialPickMedia: boolean;
  sendOpeningMediaIfConfigured: () => Promise<boolean>;
  logModelUsed: "greeting" | "default_opening";
}): Promise<RestartSalesFlowFromGreetingResult> {
  const phase: HeyzoeSessionPhase = "opening";
  const unchanged: RestartSalesFlowFromGreetingResult = {
    ranContinuation: false,
    contactSessionPhase: phase,
    contactFlowStep: 0,
    sfClickedCtaKinds: [],
    contactInstagramFollowPromptSent: false,
    contactTrialRegistered: false,
    contactTrialRegisteredAt: null,
    allowTrialCtaThisSession: true,
  };

  const didSendOpeningMedia = await input.sendOpeningMediaIfConfigured();
  if (didSendOpeningMedia) {
    await sleepMs(input.knowledge?.openingMediaType === "video" ? 2200 : 1300);
  }

  const out = input.knowledge
    ? getWhatsAppOpeningGreetingTextOnly(input.knowledge).trim()
    : `היי! כאן ${input.business_slug}.\nאשמח לעזור - שלחו שאלה בקצרה.`;

  if (input.knowledge) {
    const greetOnly = getWhatsAppOpeningGreetingTextOnly(input.knowledge);
    await sendWhatsAppTextOrMenu(input.msg.toNumber, input.msg.from, greetOnly, [], input.accountSid, input.authToken, {
      footerHint: "",
    }).catch((e) => console.error("[WA Webhook] Send greeting reply failed:", e));
  } else {
    await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, out, input.accountSid, input.authToken).catch((e) =>
      console.error("[WA Webhook] Send greeting reply failed:", e)
    );
  }

  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: out,
    model_used: input.logModelUsed,
    session_id: input.sessionId,
  });

  if (!input.businessId || !input.knowledge?.salesFlowConfig) {
    return unchanged;
  }

  await updateContactSessionPhase({
    supabase: input.supabase,
    businessId: input.businessId,
    phone: input.msg.from,
    phase,
  });
  await resetContactSalesFlowStateForGreeting({
    supabase: input.supabase,
    businessId: input.businessId,
    phone: input.msg.from,
  });

  await sendFlowContinuation({
    phase,
    contact: { flow_step: 0 },
    knowledge: input.knowledge,
    msg: input.msg,
    accountSid: input.accountSid,
    authToken: input.authToken,
    supabase: input.supabase,
    businessId: input.businessId,
    business_slug: input.business_slug,
    sessionId: input.sessionId,
    salesFlowServices: input.salesFlowServices,
    trialRegistered: false,
    allowTrialCta: true,
    blockTrialPickMedia: input.blockTrialPickMedia,
    sfConsumedKinds: [],
    instagramFollowPromptSent: false,
  });

  return {
    ranContinuation: true,
    contactSessionPhase: phase,
    contactFlowStep: 0,
    sfClickedCtaKinds: [],
    contactInstagramFollowPromptSent: false,
    contactTrialRegistered: false,
    contactTrialRegisteredAt: null,
    allowTrialCtaThisSession: true,
  };
}

const SALES_FLOW_CONTINUATION_PHASES = new Set<HeyzoeSessionPhase>([
  "opening",
  "warmup",
  "schedule_date",
  "schedule_time",
  "cta",
  "registered",
]);

function buildShortCustomerServiceOfferLine(customerServicePhone: string): string {
  const csPhone = customerServicePhone.trim();
  return csPhone
    ? `מוזמנים להתקשר לשירות הלקוחות שלנו:\n${csPhone}`
    : "מוזמנים לכתוב כאן ונחזור אליכם.";
}

/** בחירת תפריט שלא זוהתה: רמז CS + שליחה מחדש של שלב הפלואו, או איפוס «היי». */
async function recoverUnrecognizedMenuPick(input: {
  knowledge: BusinessKnowledgePack | null;
  salesFlowServices: SfServiceRow[];
  msg: WaIncomingText;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string | null;
  business_slug: string;
  sessionId: string;
  contactSessionPhase: HeyzoeSessionPhase;
  contactFlowStep: number;
  contactTrialRegistered: boolean | null;
  allowTrialCtaThisSession: boolean;
  sfClickedCtaKinds: string[];
  contactInstagramFollowPromptSent: boolean;
  blockTrialPickMedia: boolean;
  sendOpeningMediaIfConfigured: () => Promise<boolean>;
  logModelUsed: string;
}): Promise<void> {
  if (input.knowledge?.salesFlowConfig && input.businessId && input.knowledge.warmupSessionEnabled !== false) {
    try {
      const warmPick = await attemptWarmupExtraMenuPick({
        knowledge: input.knowledge,
        salesFlowServices: input.salesFlowServices,
        msg: input.msg,
        accountSid: input.accountSid,
        authToken: input.authToken,
        supabase: input.supabase,
        businessId: input.businessId,
        business_slug: input.business_slug,
        sessionId: input.sessionId,
        contactSessionPhase: input.contactSessionPhase,
        contactFlowStep: input.contactFlowStep,
        contactTrialRegistered: input.contactTrialRegistered,
        allowTrialCtaThisSession: input.allowTrialCtaThisSession,
        sfClickedCtaKinds: input.sfClickedCtaKinds,
        contactInstagramFollowPromptSent: input.contactInstagramFollowPromptSent,
        blockTrialPickMedia: input.blockTrialPickMedia,
        debugTag: `menu-recovery:${input.logModelUsed}`,
      });
      if (warmPick.handled) {
        console.info("[WA Webhook] menu pick recovery handled via warmup §2.5", {
          business_slug: input.business_slug,
          session_id: input.sessionId,
          logModelUsed: input.logModelUsed,
        });
        return;
      }
    } catch (e) {
      console.error("[WA Webhook] menu pick recovery warmup attempt failed:", e);
    }
  }

  const hint = "נראה שהבחירה לא הותאמה לתפריט — אפשר לנסות שוב מההודעה הבאה.";
  const txt = `${hint}\n\n${buildShortCustomerServiceOfferLine(input.knowledge?.customerServicePhone ?? "")}`;
  await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, txt, input.accountSid, input.authToken).catch((e) =>
    console.error("[WA Webhook] menu pick recovery CS hint failed:", e)
  );
  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: txt,
    model_used: input.logModelUsed,
    session_id: input.sessionId,
  });

  const phase = input.contactSessionPhase;
  const canContinue =
    Boolean(input.businessId) &&
    Boolean(input.knowledge?.salesFlowConfig) &&
    SALES_FLOW_CONTINUATION_PHASES.has(phase);

  if (canContinue) {
    try {
      await sendFlowContinuation({
        phase,
        contact: { flow_step: input.contactFlowStep },
        knowledge: input.knowledge!,
        msg: input.msg,
        accountSid: input.accountSid,
        authToken: input.authToken,
        supabase: input.supabase,
        businessId: input.businessId!,
        business_slug: input.business_slug,
        sessionId: input.sessionId,
        salesFlowServices: input.salesFlowServices,
        trialRegistered: input.contactTrialRegistered,
        allowTrialCta: input.allowTrialCtaThisSession,
        blockTrialPickMedia: input.blockTrialPickMedia,
        sfConsumedKinds: input.sfClickedCtaKinds,
        instagramFollowPromptSent: input.contactInstagramFollowPromptSent,
      });
      return;
    } catch (e) {
      console.error("[WA Webhook] menu pick recovery sendFlowContinuation failed:", e);
    }
  } else {
    console.warn("[WA Webhook] menu pick recovery: unclear phase or missing sales flow — restarting greeting", {
      phase,
      business_slug: input.business_slug,
      session_id: input.sessionId,
    });
  }

  await restartSalesFlowFromGreeting({
    knowledge: input.knowledge,
    salesFlowServices: input.salesFlowServices,
    msg: input.msg,
    accountSid: input.accountSid,
    authToken: input.authToken,
    supabase: input.supabase,
    businessId: input.businessId,
    business_slug: input.business_slug,
    sessionId: input.sessionId,
    blockTrialPickMedia: input.blockTrialPickMedia,
    sendOpeningMediaIfConfigured: input.sendOpeningMediaIfConfigured,
    logModelUsed: "greeting",
  });
}

async function bumpContactFlowStep(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  phone: string;
  nextStep: number;
}): Promise<void> {
  const { supabase, businessId, phone, nextStep } = input;
  const step = Number.isFinite(nextStep) && nextStep >= 0 ? Math.floor(nextStep) : 0;
  try {
    const { error } = await supabase.from("contacts").update({ flow_step: step }).eq("business_id", businessId).eq("phone", phone);
    if (error) console.warn("[WA Webhook] flow_step update failed:", error.message);
  } catch (e) {
    console.warn("[WA Webhook] flow_step update threw:", e);
  }
}

async function bumpSfConsumedCtaKind(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  phone: string;
  kind: string;
  previous: string[];
}): Promise<string[]> {
  const { supabase, businessId, phone, kind, previous } = input;
  if (previous.includes(kind)) return previous;
  const next = [...previous, kind];
  try {
    const { error } = await supabase
      .from("contacts")
      .update({ sf_clicked_cta_kinds: next })
      .eq("business_id", businessId)
      .eq("phone", phone);
    if (error) console.warn("[WA Webhook] sf_clicked_cta_kinds update:", error.message);
    else return next;
  } catch (e) {
    console.warn("[WA Webhook] sf_clicked_cta_kinds update threw:", e);
  }
  return previous;
}

type ContactScheduleSelectionState = {
  requestedDate: string;
  requestedTime: string;
};

const HE_DAY_SORT_ORDER: Record<string, number> = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5, ש: 6 };

function sortHeScheduleSlots<T extends { day: string; time: string }>(slots: T[]): T[] {
  const toMin = (t: string): number => {
    const m = String(t ?? "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!m) return 10_000;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  return [...slots].sort((a, b) => {
    const da = HE_DAY_SORT_ORDER[a.day] ?? 99;
    const db = HE_DAY_SORT_ORDER[b.day] ?? 99;
    if (da !== db) return da - db;
    return toMin(a.time) - toMin(b.time);
  });
}

function isCourseWithDefinedDates(service: SfServiceRow | null): boolean {
  if (service?.offerKind !== "course") return false;
  if ((service.scheduleSlots?.length ?? 0) > 0) return false;
  return Boolean(service.courseStartDate.trim() && service.courseEndDate.trim());
}

function shouldCollectCourseCycleStartPick(
  knowledge: BusinessKnowledgePack,
  service: SfServiceRow | null
): boolean {
  if (knowledge.scheduleDirectRegistration !== false) return false;
  if (service?.offerKind !== "course") return false;
  if (isCourseWithDefinedDates(service)) return false;
  return courseHasCycleSchedulePickData(service.courseCycles ?? []);
}

function shouldCollectScheduleSelection(knowledge: BusinessKnowledgePack, service: SfServiceRow | null): boolean {
  if (shouldCollectCourseCycleStartPick(knowledge, service)) return false;
  return knowledge.scheduleDirectRegistration === false && !isCourseWithDefinedDates(service);
}

function scheduleSelectionPhaseAfterService(knowledge: BusinessKnowledgePack, service: SfServiceRow | null): HeyzoeSessionPhase {
  const needsSchedulePick =
    shouldCollectScheduleSelection(knowledge, service) ||
    shouldCollectCourseCycleStartPick(knowledge, service);
  return needsSchedulePick ? "schedule_date" : "cta";
}

/** אחרי בחירת מועד/מחזור — תמיד CTA (חימום כבר עבר לפניו). */
function phaseAfterSchedulePickComplete(): HeyzoeSessionPhase {
  return "cta";
}

function courseCtaFillFromService(service: SfServiceRow | null, pickedCycleStartDisplay?: string) {
  const cycles = service?.courseCycles ?? [];
  const picked = pickedCycleStartDisplay?.trim()
    ? findCourseCycleByDisplayStartDate(cycles, pickedCycleStartDisplay)
    : null;
  const schedulePhrase = pickedCycleStartDisplay?.trim()
    ? buildCourseSchedulePhraseForCtaFromPick(cycles, pickedCycleStartDisplay)
    : buildCourseSchedulePhraseForCta(cycles);
  const { day: scheduleDay, hour: scheduleHour } = resolveCourseScheduleDayHourForCta(
    cycles,
    pickedCycleStartDisplay
  );
  return {
    priceText: service?.priceText ?? "",
    sessionsText: service?.courseSessionsText ?? "",
    startDate: picked ? formatCycleDateShort(picked.start_date) : service?.courseStartDate ?? "",
    endDate: picked?.end_date?.trim()
      ? formatCycleDateShort(picked.end_date)
      : service?.courseEndDate ?? "",
    schedulePhrase,
    scheduleDay,
    scheduleHour,
  };
}

function courseSchedulePhraseForRegistration(
  service: SfServiceRow | null,
  pickedDisplayStartDate: string
): string {
  if (!service || service.offerKind !== "course") return "";
  const cycles = service.courseCycles ?? [];
  const picked = findCourseCycleByDisplayStartDate(cycles, pickedDisplayStartDate);
  if (picked) {
    const slotPhrase = formatCycleSlotsPhrase(picked.schedule_slots);
    if (slotPhrase) return slotPhrase;
  }
  return buildCourseSchedulePhraseForCtaFromPick(cycles, pickedDisplayStartDate);
}

function parseScheduleDateInput(text: string): string | null {
  const cleaned = text
    .trim()
    // Strip common bidi/isolation marks that WhatsApp may append (e.g. trailing U+2069).
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "");
  const m = cleaned.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  return `${day}.${month}`;
}

function parseScheduleTimeInput(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "");
  const m = cleaned.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

function heDayOfWeekForDm(dm: string): string | null {
  const m = String(dm ?? "")
    .trim()
    .match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || day < 1 || day > 31 || month < 1 || month > 12) return null;

  const now = new Date();
  const yearNow = now.getFullYear();
  // If the picked date already passed this year (or is invalid for current year), treat it as next year's date.
  const tryDate = (year: number) => new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  let d = tryDate(yearNow);
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const nowUtc = new Date(Date.UTC(yearNow, now.getMonth(), now.getDate(), 12, 0, 0));
  if (d.getTime() < nowUtc.getTime() - 2 * 24 * 60 * 60 * 1000) {
    const d2 = tryDate(yearNow + 1);
    if (!Number.isNaN(d2.getTime()) && d2.getUTCMonth() === month - 1 && d2.getUTCDate() === day) d = d2;
  }

  try {
    return new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "Asia/Jerusalem" }).format(d);
  } catch {
    return null;
  }
}

function buildScheduleDateQuestion(_knowledge: BusinessKnowledgePack, service: SfServiceRow | null): string {
  const serviceName = service?.name?.trim() || "האימון";
  return [buildScheduleSlotPickQuestion(serviceName), "בחרו מועד מהכפתורים למטה."].join("\n");
}

function buildScheduleTimeQuestion(service: SfServiceRow | null): string {
  const serviceName = service?.name?.trim() || "האימון";
  return `באיזו שעה הכי מתאים לך להגיע ל${serviceName}? נא לכתוב שעה בפורמט: 19:00`;
}

function shouldSkipSalesFlowPromptResend(input: {
  inboundText?: string;
  aiReplyCoreClean?: string;
  knowledge: BusinessKnowledgePack;
}): boolean {
  const inbound = String(input.inboundText ?? "").trim();
  if (inbound && userRequestedHumanAgent(inbound)) return true;
  const csPhone = input.knowledge.customerServicePhone?.trim() ?? "";
  const replyForCs = String(input.aiReplyCoreClean ?? "").trim();
  return Boolean(replyForCs && replyRefersToCustomerService(replyForCs, csPhone));
}

async function trySendSalesFlowHumanAgentHandoff(input: {
  inboundText: string;
  knowledge: BusinessKnowledgePack;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  business_slug: string;
  sessionId: string;
}): Promise<boolean> {
  const inbound = String(input.inboundText ?? "").trim();
  if (!inbound || !userRequestedHumanAgent(inbound)) return false;
  const { recentSalesFlowHumanHandoffSent } = await import("@/lib/human-requested");
  if (await recentSalesFlowHumanHandoffSent({ businessSlug: input.business_slug, sessionId: input.sessionId })) {
    return true;
  }
  const csPhone = input.knowledge.customerServicePhone?.trim() ?? "";
  const txt = buildSalesFlowHumanAgentHandoffReply(csPhone);
  await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, txt, input.accountSid, input.authToken).catch(
    (e) => console.error("[WA Webhook] Send human-agent handoff failed:", e)
  );
  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: txt,
    model_used: csPhone ? "sales_flow_human_agent_handoff" : "sales_flow_human_agent_handoff_no_phone",
    session_id: input.sessionId,
  });
  return true;
}

function buildScheduleTimeSideAnswer(text: string, knowledge: BusinessKnowledgePack, service: SfServiceRow | null): string {
  if (userRequestedHumanAgent(text)) return "";
  if (isAddressOrDirectionsIntent(text)) {
    const lang = resolveBusinessContentLanguageFromKnowledge(knowledge);
    const address = knowledge.addressText?.trim() ?? "";
    const directions = knowledge.directionsText?.trim() ?? "";
    if (!address) return addressMissingMessage(lang);
    return [
      `${addressOurPrefix(lang)} ${address}`,
      directions ? `${addressDirectionsPrefix(lang)} ${directions}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const norm = normalizeGreetingToken(text);
  if (/(מחיר|כמה עולה|עלות|תשלום|עולה)/u.test(norm)) {
    const price = service?.priceText?.trim() ?? "";
    return price ? `המחיר הוא ${price}.` : "אין לי מחיר מדויק כאן, הצוות ישמח לעזור בזה.";
  }
  if (/[?؟]/.test(text)) {
    return "בשמחה, אפשר לשאול כאן ואעזור בקצרה.";
  }
  return "";
}

async function fetchContactScheduleSelectionState(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  phone: string;
}): Promise<ContactScheduleSelectionState> {
  try {
    const phoneVariants = contactPhoneLookupVariants(input.phone);
    const phones = phoneVariants.length ? phoneVariants : [input.phone];
    const { data, error } = await input.supabase
      .from("contacts")
      .select("sf_requested_date, sf_requested_time, last_contact_at")
      .eq("business_id", input.businessId)
      .in("phone", phones);
    if (error || !data?.length) return { requestedDate: "", requestedTime: "" };

    const rows = data as Array<{
      sf_requested_date?: unknown;
      sf_requested_time?: unknown;
      last_contact_at?: string | null;
    }>;

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
    if (!row) return { requestedDate: "", requestedTime: "" };
    return {
      requestedDate: String(row.sf_requested_date ?? "").trim(),
      requestedTime: String(row.sf_requested_time ?? "").trim(),
    };
  } catch {
    return { requestedDate: "", requestedTime: "" };
  }
}

async function sendScheduleSelectionDateQuestion(input: {
  knowledge: BusinessKnowledgePack;
  selectedService: SfServiceRow | null;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
}): Promise<void> {
  const question = buildScheduleDateQuestion(input.knowledge, input.selectedService);
  await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, question, input.accountSid, input.authToken).catch((e) =>
    console.error("[WA Webhook] Send schedule date question failed:", e)
  );
  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: question,
    model_used: "sales_flow_schedule_date_question",
    session_id: input.sessionId,
  });
  await updateContactSessionPhase({ supabase: input.supabase, businessId: input.businessId, phone: input.msg.from, phase: "schedule_date" });
}

async function sendScheduleSelectionTimeQuestion(input: {
  selectedService: SfServiceRow | null;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  prefix?: string;
}): Promise<void> {
  const question = buildScheduleTimeQuestion(input.selectedService);
  const text = [input.prefix?.trim() ?? "", question].filter(Boolean).join("\n\n");
  await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, text, input.accountSid, input.authToken).catch((e) =>
    console.error("[WA Webhook] Send schedule time question failed:", e)
  );
  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: text,
    model_used: "sales_flow_schedule_time_question",
    session_id: input.sessionId,
  });
  await updateContactSessionPhase({ supabase: input.supabase, businessId: input.businessId, phone: input.msg.from, phase: "schedule_time" });
}

const SCHEDULE_SLOT_PICK_MAX = 10;
const SCHEDULE_PICK_CHANGE_SERVICE_LABEL = "בחירת אימון אחר";

function scheduleBoardAssetsFromKnowledge(knowledge: BusinessKnowledgePack, blockMedia: boolean) {
  const schedBtn = knowledge.salesFlowConfig?.cta_buttons?.find((b) => b.kind === "schedule");
  return resolveScheduleBoardAssets({
    schedulePublicUrl: knowledge.schedulePublicUrl,
    arboxLink: knowledge.arboxLink,
    scheduleScanImageUrl: knowledge.scheduleScanImageUrl,
    scheduleCtaImageUrl: schedBtn?.schedule_cta_image_url,
    blockMedia,
  });
}

type ScheduleBoardDelivery = "image" | "link" | "none";

/** המתנה אחרי תמונת מערכת שעות — WA לעיתים מציג טקסט לפני שהמדיה מוכנה. */
const SCHEDULE_BOARD_IMAGE_BEFORE_MENU_DELAY_MS = 2200;

/** סשן מערכת שעות — נשלח אוטומטית אחרי הפתיחה (תמונה או קישור), לפני בחירת מוצר / המשך הפלואו. */
async function sendScheduleBoardAfterOpening(input: {
  assets: ScheduleBoardAssets;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  business_slug: string;
  sessionId: string;
  modelUsed?: string;
}): Promise<ScheduleBoardDelivery> {
  const { assets, msg, accountSid, authToken, business_slug, sessionId } = input;
  const modelUsed = input.modelUsed ?? "sales_flow_schedule_board_after_opening";
  if (assets.canSendScheduleImage && assets.scheduleImgUrl) {
    try {
      await sendWhatsAppMediaMessage(
        msg.toNumber,
        msg.from,
        assets.scheduleImgUrl,
        accountSid,
        authToken,
        SCHEDULE_BOARD_CAPTION,
        "image"
      );
      await logMessage({
        business_slug,
        role: "assistant",
        content: `[media] ${assets.scheduleImgUrl}\n\n${SCHEDULE_BOARD_CAPTION}`,
        model_used: modelUsed,
        session_id: sessionId,
      });
      await sleepMs(900);
      return "image";
    } catch (e) {
      console.error("[WA Webhook] Send schedule board after opening failed:", e);
      return "none";
    }
  }
  const link = assets.link.trim();
  if (link) {
    const txt = `${SCHEDULE_BOARD_CAPTION}: ${link}`;
    await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] Send schedule board link after opening failed:", e)
    );
    await logMessage({
      business_slug,
      role: "assistant",
      content: txt,
      model_used: modelUsed,
      session_id: sessionId,
    });
    return "link";
  }
  return "none";
}

const SCHEDULE_BOARD_SENT_MODELS = new Set([
  "sales_flow_schedule_board_after_opening",
  "sales_flow_schedule_board_after_opening_single",
  "sales_flow_schedule_board_after_opening_multi",
  "sales_flow_schedule_board_before_service_pick",
]);

async function ensureScheduleBoardSentOnce(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  assets: ScheduleBoardAssets;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  business_slug: string;
  sessionId: string;
  modelUsed?: string;
}): Promise<ScheduleBoardDelivery> {
  const { supabase, business_slug, sessionId } = input;
  try {
    const { data: markers } = await supabase
      .from("messages")
      .select("model_used, created_at")
      .eq("business_slug", business_slug)
      .eq("session_id", sessionId)
      .eq("role", "assistant")
      .in("model_used", [
        ...Array.from(SCHEDULE_BOARD_SENT_MODELS),
        "greeting",
        "default_opening",
      ])
      .order("created_at", { ascending: false })
      .limit(60);
    const lastResetAt =
      (markers ?? []).find((m: any) => m?.model_used === "greeting" || m?.model_used === "default_opening")
        ?.created_at ?? null;
    const lastScheduleAt =
      (markers ?? []).find((m: any) => SCHEDULE_BOARD_SENT_MODELS.has(String(m?.model_used ?? "")))?.created_at ??
      null;
    const alreadySent = Boolean(lastScheduleAt && (!lastResetAt || String(lastScheduleAt) > String(lastResetAt)));
    if (alreadySent) return "none";
  } catch (e) {
    console.warn("[WA Webhook] schedule board marker check failed (continuing):", e);
  }

  return sendScheduleBoardAfterOpening({
    assets: input.assets,
    msg: input.msg,
    accountSid: input.accountSid,
    authToken: input.authToken,
    business_slug: input.business_slug,
    sessionId: input.sessionId,
    modelUsed: input.modelUsed,
  });
}

async function wasScheduleBoardSentInSession(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  sessionId: string;
}): Promise<boolean> {
  try {
    const { data: markers } = await input.supabase
      .from("messages")
      .select("model_used, created_at")
      .eq("business_slug", input.business_slug)
      .eq("session_id", input.sessionId)
      .eq("role", "assistant")
      .in("model_used", [
        ...Array.from(SCHEDULE_BOARD_SENT_MODELS),
        "greeting",
        "default_opening",
        "sales_flow_schedule_board_before_service_pick",
      ])
      .order("created_at", { ascending: false })
      .limit(60);
    const lastResetAt =
      (markers ?? []).find((m: { model_used?: unknown }) => {
        const mu = String(m?.model_used ?? "");
        return mu === "greeting" || mu === "default_opening";
      })?.created_at ?? null;
    const lastScheduleAt =
      (markers ?? []).find((m: { model_used?: unknown }) => {
        const mu = String(m?.model_used ?? "");
        return (
          SCHEDULE_BOARD_SENT_MODELS.has(mu) || mu === "sales_flow_schedule_board_before_service_pick"
        );
      })?.created_at ?? null;
    return Boolean(lastScheduleAt && (!lastResetAt || String(lastScheduleAt) > String(lastResetAt)));
  } catch (e) {
    console.warn("[WA Webhook] schedule board marker check failed (continuing):", e);
    return false;
  }
}

/** אחרי חימום (או כשחימום כבוי): מערכת שעות → בחירת מוצר (מרובים) / המשך מסלול (יחיד */
async function advanceAfterWarmupSessionComplete(input: {
  knowledge: BusinessKnowledgePack;
  salesFlowServices: SfServiceRow[];
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  blockTrialPickMedia?: boolean;
  trialRegistered: boolean | null;
  allowTrialCta: boolean;
  sfConsumedKinds?: string[];
  instagramFollowPromptSent?: boolean;
}): Promise<void> {
  const {
    knowledge,
    salesFlowServices,
    msg,
    accountSid,
    authToken,
    supabase,
    businessId,
    business_slug,
    sessionId,
    blockTrialPickMedia,
    trialRegistered,
    allowTrialCta,
    sfConsumedKinds,
    instagramFollowPromptSent,
  } = input;

  try {
    const scheduleBoardDelivery = await ensureScheduleBoardSentOnce({
      supabase,
      assets: scheduleBoardAssetsFromKnowledge(knowledge, blockTrialPickMedia ?? false),
      msg,
      accountSid,
      authToken,
      business_slug,
      sessionId,
      modelUsed:
        salesFlowServices.length === 1
          ? "sales_flow_schedule_board_after_opening_single"
          : "sales_flow_schedule_board_after_opening_multi",
    });

    if (salesFlowServices.length > 1) {
      if (scheduleBoardDelivery === "image") {
        await sleepMs(SCHEDULE_BOARD_IMAGE_BEFORE_MENU_DELAY_MS);
      }
      await sendOpeningServicePickMenu({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        business_slug,
        sessionId,
        blockMedia: blockTrialPickMedia,
        skipScheduleBoard: true,
      });
      await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: "opening" });
      return;
    }

    const singleService = salesFlowServices[0] ?? null;
    const nextPhase = scheduleSelectionPhaseAfterService(knowledge, singleService);
    await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: nextPhase });
    await sendFlowContinuation({
      phase: nextPhase,
      contact: { flow_step: 0 },
      knowledge,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      salesFlowServices,
      trialRegistered,
      allowTrialCta,
      blockTrialPickMedia,
      sfConsumedKinds,
      instagramFollowPromptSent,
    });
  } catch (e) {
    console.error("[WA Webhook] advanceAfterWarmupSessionComplete failed:", e);
    throw e;
  }
}

type WarmupExtraCleanStep = {
  question: string;
  options: string[];
  replies: string[];
};

async function buildWarmupExtraCleanSteps(input: {
  cfg: import("@/lib/sales-flow").SalesFlowConfig;
  salesFlowServices: SfServiceRow[];
  business_slug: string;
  session_id: string;
  incomingMsg?: Pick<WaIncomingText, "text" | "metaInteractiveReplyId">;
}): Promise<{
  cleanSteps: WarmupExtraCleanStep[];
  hasWarmupQ1: boolean;
  warmupServiceName: string;
  warmupOfferKind: string;
  resolvedVia: "unified_warmup";
}> {
  const wb = resolveWarmupExperienceConfig(input.cfg);
  const { cleanSteps, hasWarmupQ1 } = buildWarmupExtraCleanStepsFromWb(wb);
  const resolvedVia = "unified_warmup" as const;
  return {
    cleanSteps,
    hasWarmupQ1,
    warmupServiceName: "",
    warmupOfferKind: "trial",
    resolvedVia,
  };
}

/** מיפוי בחירת תפריט (במיוחד list_reply) לשלב+אופציה — בלי תלות ב-lastIdx/event. */
function findWarmupExtraPickAcrossSteps(
  cleanSteps: WarmupExtraCleanStep[],
  msg: Pick<WaIncomingText, "text" | "metaInteractiveReplyId">
): { stepIdx: number; optionIdx: number } | null {
  const incomingText = msg.text.trim();
  const metaId = msg.metaInteractiveReplyId?.trim() ?? "";
  const decoded = metaId ? metaInteractiveDecodeReplyId(metaId) : null;
  const labelCandidates = [decoded, incomingText].filter((x): x is string => Boolean(x?.length));

  for (let si = 0; si < cleanSteps.length; si++) {
    const opts = cleanSteps[si]!.options.map((o) => String(o ?? "").trim()).filter(Boolean);
    if (opts.length < 2) continue;

    const resolvedMetaLabel = metaId
      ? resolveMetaInteractiveLabel(metaId, incomingText, opts)
      : null;
    const stepLabelCandidates = [...labelCandidates];
    if (resolvedMetaLabel?.trim()) {
      stepLabelCandidates.unshift(resolvedMetaLabel.trim());
    }

    for (const label of stepLabelCandidates) {
      const variants = [label, truncateWaButtonLabel(label)].filter((x, i, arr) => x && arr.indexOf(x) === i);
      for (const variant of variants) {
        for (let oi = 0; oi < opts.length; oi++) {
          const option = opts[oi]!;
          const optionTruncated = truncateWaButtonLabel(option);
          if (waLabelMatches(option, variant) || waLabelMatches(optionTruncated, variant)) {
            return { stepIdx: si, optionIdx: oi };
          }
        }
      }
    }

    const byMenu = findWaMenuOptionIndex(incomingText, msg.metaInteractiveReplyId, opts);
    if (byMenu >= 0) {
      return { stepIdx: si, optionIdx: byMenu };
    }
  }

  return null;
}

function resolveActiveWarmupExtraMenuIndex(input: {
  contactSessionPhase: HeyzoeSessionPhase;
  contactFlowStep: number;
  hasWarmupQ1: boolean;
  cleanSteps: WarmupExtraCleanStep[];
  lastAssistModel: string | null;
  lastIdxFromEvent: number | null;
  incomingText: string;
  metaInteractiveReplyId?: string;
}): number | null {
  const isWarmupExtraMenu = isWarmupExtraMenuModel(input.lastAssistModel);
  if (input.contactSessionPhase !== "warmup" && !isWarmupExtraMenu) return null;

  let lastIdx =
    input.contactSessionPhase === "warmup" || isWarmupExtraMenu
      ? inferWarmupExtraStepIndex({
          flowStep: input.contactFlowStep,
          hasWarmupQ1: input.hasWarmupQ1,
          cleanStepsCount: input.cleanSteps.length,
          lastIdxFromEvent: input.lastIdxFromEvent,
          lastAssistModel: input.lastAssistModel,
          sessionPhase: input.contactSessionPhase,
        })
      : input.lastIdxFromEvent;

  if (input.contactSessionPhase === "warmup" || isWarmupExtraMenu) {
    const cross = findWarmupExtraPickAcrossSteps(input.cleanSteps, {
      text: input.incomingText,
      metaInteractiveReplyId: input.metaInteractiveReplyId,
    });
    if (cross) return cross.stepIdx;
  }

  return lastIdx;
}

type WarmupExtraPickResult =
  | { handled: false }
  | { handled: true; contactSessionPhase?: HeyzoeSessionPhase; contactFlowStep?: number };

async function sendWarmupReplyThenNextQuestionMenu(input: {
  msg: Pick<WaIncomingText, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  business_slug: string;
  sessionId: string;
  replyText: string;
  nextQuestion: string;
  nextOptionLabels: string[];
  menuFooter: string;
  contentLang: import("@/lib/business-content-lang").BusinessContentLanguage;
  replyModelUsed: string;
  sendErrorLabel: string;
  /** When true, Meta/Twilio send errors propagate (for CAS + rollback paths). */
  rethrowOnFailure?: boolean;
}): Promise<void> {
  const replyText = String(input.replyText ?? "").trim();
  const nextQuestion = String(input.nextQuestion ?? "").trim();
  const nextOpts = input.nextOptionLabels.map((o) => String(o ?? "").trim()).filter(Boolean);
  const rethrow = input.rethrowOnFailure === true;

  if (replyText) {
    try {
      await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, replyText, input.accountSid, input.authToken);
    } catch (e) {
      console.error(`[WA Webhook] ${input.sendErrorLabel} reply failed:`, e);
      if (rethrow) throw e;
    }
    await logMessage({
      business_slug: input.business_slug,
      role: "assistant",
      content: replyText,
      model_used: input.replyModelUsed,
      session_id: input.sessionId,
    });
  }

  if (!nextQuestion) return;

  try {
    await sendWhatsAppTextOrMenu(
      input.msg.toNumber,
      input.msg.from,
      nextQuestion,
      nextOpts,
      input.accountSid,
      input.authToken,
      { footerHint: input.menuFooter, language: input.contentLang }
    );
  } catch (e) {
    console.error(`[WA Webhook] ${input.sendErrorLabel} next question failed:`, e);
    if (rethrow) throw e;
    await logMessage({
      business_slug: input.business_slug,
      role: "assistant",
      content: formatInteractiveConversationLog(nextQuestion, nextOpts, input.menuFooter),
      model_used: "sales_flow_warmup_extra",
      session_id: input.sessionId,
    });
    return;
  }

  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: formatInteractiveConversationLog(nextQuestion, nextOpts, input.menuFooter),
    model_used: "sales_flow_warmup_extra",
    session_id: input.sessionId,
  });
}

async function executeWarmupExtraPickAt(input: {
  knowledge: BusinessKnowledgePack;
  salesFlowServices: SfServiceRow[];
  msg: WaIncomingText;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  contactTrialRegistered: boolean | null;
  allowTrialCtaThisSession: boolean;
  sfClickedCtaKinds: string[];
  contactInstagramFollowPromptSent: boolean;
  blockTrialPickMedia: boolean;
  debugTag: string;
  cleanSteps: WarmupExtraCleanStep[];
  lastIdx: number;
  pickedIdx: number;
}): Promise<WarmupExtraPickResult> {
  const current = input.cleanSteps[input.lastIdx];
  const opts = (current?.options ?? []).map((o) => String(o ?? "").trim()).filter(Boolean);
  const picked = opts[input.pickedIdx];
  if (!picked) return { handled: false };

  const replyRaw = String(current?.replies?.[input.pickedIdx] ?? "").trim();
  const menuFooter = salesFlowMenuFooter(input.knowledge);
  const contentLang = resolveBusinessContentLanguageFromKnowledge(input.knowledge);
  const nextIdx = input.lastIdx + 1;
  if (nextIdx < input.cleanSteps.length) {
    const next = input.cleanSteps[nextIdx]!;
    const nextOpts = next.options.map((o) => String(o ?? "").trim()).filter(Boolean);
    const cas = await tryAdvanceWarmupAwaitingOnPick({
      supabase: input.supabase,
      businessId: input.businessId,
      phone: input.msg.from,
      pickIdx: input.lastIdx,
      nextIdx,
    });
    if (!cas.advanced) {
      return { handled: true };
    }
    try {
      await sendWarmupReplyThenNextQuestionMenu({
        msg: input.msg,
        accountSid: input.accountSid,
        authToken: input.authToken,
        business_slug: input.business_slug,
        sessionId: input.sessionId,
        replyText: replyRaw,
        nextQuestion: next.question,
        nextOptionLabels: nextOpts,
        menuFooter,
        contentLang,
        replyModelUsed: "sales_flow_warmup_extra",
        sendErrorLabel: "Send warmup-extra next step",
        rethrowOnFailure: true,
      });
    } catch (e) {
      await rollbackWarmupAwaitingAfterSendFailure({
        supabase: input.supabase,
        businessId: input.businessId,
        phone: input.msg.from,
        readIdx: cas.readIdx,
        nextIdx: cas.nextIdx,
        context: "executeWarmupExtraPickAt",
        sendError: e,
      });
      return { handled: true };
    }
    try {
      await logMessage({
        business_slug: input.business_slug,
        role: "event",
        content: `${HEYZOE_SF_WARMUP_EXTRA_PREFIX}${nextIdx}`,
        model_used: "sf_warmup_extra",
        session_id: input.sessionId,
      });
    } catch (e) {
      console.error("[WA Webhook] warmup extra pick event log failed (send succeeded; no CAS rollback):", e);
    }
    return { handled: true };
  }

  if (replyRaw) {
    await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, replyRaw, input.accountSid, input.authToken).catch((e) =>
      console.error("[WA Webhook] Send warmup-extra final reply failed:", e)
    );
    await logMessage({
      business_slug: input.business_slug,
      role: "assistant",
      content: replyRaw,
      model_used: "sales_flow_warmup_extra",
      session_id: input.sessionId,
    });
  } else {
    console.warn("[WA Webhook] Warmup extra pick without reply text", {
      business_slug: input.business_slug,
      session_id: input.sessionId,
      lastIdx: input.lastIdx,
      picked,
      debugTag: input.debugTag,
    });
  }

  let nextPhase: HeyzoeSessionPhase | undefined;
  let nextFlowStep: number | undefined;
  if (replyRaw) {
    try {
      await advanceAfterWarmupSessionComplete({
        knowledge: input.knowledge,
        salesFlowServices: input.salesFlowServices,
        msg: input.msg,
        accountSid: input.accountSid,
        authToken: input.authToken,
        supabase: input.supabase,
        businessId: input.businessId,
        business_slug: input.business_slug,
        sessionId: input.sessionId,
        blockTrialPickMedia: input.blockTrialPickMedia,
        trialRegistered: input.contactTrialRegistered,
        allowTrialCta: input.allowTrialCtaThisSession,
        sfConsumedKinds: input.sfClickedCtaKinds,
        instagramFollowPromptSent: input.contactInstagramFollowPromptSent,
      });
      nextPhase =
        input.salesFlowServices.length > 1
          ? "opening"
          : scheduleSelectionPhaseAfterService(input.knowledge, input.salesFlowServices[0] ?? null);
      nextFlowStep = 0;
    } catch (e) {
      console.error("[WA Webhook] Warmup complete → advance failed:", e);
    }
  }

  return {
    handled: true,
    ...(nextPhase ? { contactSessionPhase: nextPhase } : {}),
    ...(nextFlowStep != null ? { contactFlowStep: nextFlowStep } : {}),
  };
}

/** §2.5 + recovery: טיפול בבחירה מתפריט שאלות נוספות בחימום (כולל replyRaw). */
async function attemptWarmupExtraMenuPick(input: {
  knowledge: BusinessKnowledgePack;
  salesFlowServices: SfServiceRow[];
  msg: WaIncomingText;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  contactSessionPhase: HeyzoeSessionPhase;
  contactFlowStep: number;
  contactTrialRegistered: boolean | null;
  allowTrialCtaThisSession: boolean;
  sfClickedCtaKinds: string[];
  contactInstagramFollowPromptSent: boolean;
  blockTrialPickMedia: boolean;
  debugTag: string;
}): Promise<WarmupExtraPickResult> {
  const cfg = input.knowledge.salesFlowConfig;
  if (!cfg || input.knowledge.warmupSessionEnabled === false) return { handled: false };

  const { cleanSteps, hasWarmupQ1 } = await buildWarmupExtraCleanSteps({
    cfg,
    salesFlowServices: input.salesFlowServices,
    business_slug: input.business_slug,
    session_id: input.sessionId,
    incomingMsg: input.msg,
  });
  if (cleanSteps.length === 0) {
    return { handled: false };
  }

  const directPick = findWarmupExtraPickAcrossSteps(cleanSteps, input.msg);
  if (directPick) {
    return executeWarmupExtraPickAt({
      knowledge: input.knowledge,
      salesFlowServices: input.salesFlowServices,
      msg: input.msg,
      accountSid: input.accountSid,
      authToken: input.authToken,
      supabase: input.supabase,
      businessId: input.businessId,
      business_slug: input.business_slug,
      sessionId: input.sessionId,
      contactTrialRegistered: input.contactTrialRegistered,
      allowTrialCtaThisSession: input.allowTrialCtaThisSession,
      sfClickedCtaKinds: input.sfClickedCtaKinds,
      contactInstagramFollowPromptSent: input.contactInstagramFollowPromptSent,
      blockTrialPickMedia: input.blockTrialPickMedia,
      debugTag: input.debugTag,
      cleanSteps,
      lastIdx: directPick.stepIdx,
      pickedIdx: directPick.optionIdx,
    });
  }

  const lastAssistModel = await fetchLastAssistantModelUsed({
    business_slug: input.business_slug,
    session_id: input.sessionId,
  });
  const lastIdxFromEvent = await fetchLastSfWarmupExtraIndex({
    business_slug: input.business_slug,
    session_id: input.sessionId,
  });
  const isWarmupExtraMenu = isWarmupExtraMenuModel(lastAssistModel);
  const lastIdx = resolveActiveWarmupExtraMenuIndex({
    contactSessionPhase: input.contactSessionPhase,
    contactFlowStep: input.contactFlowStep,
    hasWarmupQ1,
    cleanSteps,
    lastAssistModel,
    lastIdxFromEvent,
    incomingText: input.msg.text,
    metaInteractiveReplyId: input.msg.metaInteractiveReplyId,
  });

  if (!(input.contactSessionPhase === "warmup" || isWarmupExtraMenu) || lastIdx == null) {
    const lateCross = findWarmupExtraPickAcrossSteps(cleanSteps, input.msg);
    if (lateCross && (input.contactSessionPhase === "warmup" || isWarmupExtraMenu)) {
      return executeWarmupExtraPickAt({
        knowledge: input.knowledge,
        salesFlowServices: input.salesFlowServices,
        msg: input.msg,
        accountSid: input.accountSid,
        authToken: input.authToken,
        supabase: input.supabase,
        businessId: input.businessId,
        business_slug: input.business_slug,
        sessionId: input.sessionId,
        contactTrialRegistered: input.contactTrialRegistered,
        allowTrialCtaThisSession: input.allowTrialCtaThisSession,
        sfClickedCtaKinds: input.sfClickedCtaKinds,
        contactInstagramFollowPromptSent: input.contactInstagramFollowPromptSent,
        blockTrialPickMedia: input.blockTrialPickMedia,
        debugTag: input.debugTag,
        cleanSteps,
        lastIdx: lateCross.stepIdx,
        pickedIdx: lateCross.optionIdx,
      });
    }
    return { handled: false };
  }

  const current = cleanSteps[lastIdx];
  const opts = (current?.options ?? []).map((o) => String(o ?? "").trim()).filter(Boolean);
  const pickedIdx = findWaMenuOptionIndex(input.msg.text.trim(), input.msg.metaInteractiveReplyId, opts);

  if (pickedIdx < 0) {
    const retryCross = findWarmupExtraPickAcrossSteps(cleanSteps, input.msg);
    if (retryCross) {
      return executeWarmupExtraPickAt({
        knowledge: input.knowledge,
        salesFlowServices: input.salesFlowServices,
        msg: input.msg,
        accountSid: input.accountSid,
        authToken: input.authToken,
        supabase: input.supabase,
        businessId: input.businessId,
        business_slug: input.business_slug,
        sessionId: input.sessionId,
        contactTrialRegistered: input.contactTrialRegistered,
        allowTrialCtaThisSession: input.allowTrialCtaThisSession,
        sfClickedCtaKinds: input.sfClickedCtaKinds,
        contactInstagramFollowPromptSent: input.contactInstagramFollowPromptSent,
        blockTrialPickMedia: input.blockTrialPickMedia,
        debugTag: input.debugTag,
        cleanSteps,
        lastIdx: retryCross.stepIdx,
        pickedIdx: retryCross.optionIdx,
      });
    }
    if (
      current?.question &&
      opts.length >= 2 &&
      shouldResendDeterministicMenuOnUnrecognizedPick(input.msg)
    ) {
      const menuFooter = salesFlowMenuFooter(input.knowledge);
      await sendWhatsAppTextOrMenu(
        input.msg.toNumber,
        input.msg.from,
        current.question,
        opts,
        input.accountSid,
        input.authToken,
        {
          footerHint: menuFooter,
          language: resolveBusinessContentLanguageFromKnowledge(input.knowledge),
        }
      ).catch((e) => console.error("[WA Webhook] Resend warmup-extra menu failed:", e));
      await logMessage({
        business_slug: input.business_slug,
        role: "assistant",
        content: formatInteractiveConversationLog(current.question, opts, menuFooter),
        model_used: "sales_flow_warmup_extra_resend",
        session_id: input.sessionId,
      });
      return { handled: true };
    }
    return { handled: false };
  }

  return executeWarmupExtraPickAt({
    knowledge: input.knowledge,
    salesFlowServices: input.salesFlowServices,
    msg: input.msg,
    accountSid: input.accountSid,
    authToken: input.authToken,
    supabase: input.supabase,
    businessId: input.businessId,
    business_slug: input.business_slug,
    sessionId: input.sessionId,
    contactTrialRegistered: input.contactTrialRegistered,
    allowTrialCtaThisSession: input.allowTrialCtaThisSession,
    sfClickedCtaKinds: input.sfClickedCtaKinds,
    contactInstagramFollowPromptSent: input.contactInstagramFollowPromptSent,
    blockTrialPickMedia: input.blockTrialPickMedia,
    debugTag: input.debugTag,
    cleanSteps,
    lastIdx,
    pickedIdx,
  });
}

async function sendOpeningServicePickMenu(input: {
  knowledge: BusinessKnowledgePack;
  salesFlowServices: SfServiceRow[];
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  business_slug: string;
  sessionId: string;
  blockMedia?: boolean;
  modelUsed?: string;
  /** מערכת שעות כבר נשלחה (אחרי חימום) */
  skipScheduleBoard?: boolean;
}): Promise<boolean> {
  const cfg = input.knowledge.salesFlowConfig;
  if (!cfg) return false;
  const labels = input.salesFlowServices.map((s) => s.name.trim()).filter(Boolean).slice(0, 12);
  if (labels.length < 2) return false;

  const qRaw = String(cfg.multi_service_question ?? "").trim() || buildDefaultMultiServiceQuestion();
  const assets = scheduleBoardAssetsFromKnowledge(input.knowledge, input.blockMedia ?? false);
  if (!input.skipScheduleBoard) {
    const scheduleBoardDelivery = await sendScheduleBoardAfterOpening({
      assets,
      msg: input.msg,
      accountSid: input.accountSid,
      authToken: input.authToken,
      business_slug: input.business_slug,
      sessionId: input.sessionId,
      modelUsed: "sales_flow_schedule_board_before_service_pick",
    });
    if (scheduleBoardDelivery === "image") {
      await sleepMs(SCHEDULE_BOARD_IMAGE_BEFORE_MENU_DELAY_MS);
    }
  }
  const split = splitMultiServiceQuestionForWhatsApp(qRaw, assets);
  const body =
    split.menuBody.trim() ||
    stripScheduleLineFromMultiServiceQuestion(qRaw) ||
    DEFAULT_MULTI_SERVICE_QUESTION_TAIL;
  const modelUsed = input.modelUsed ?? "flow_continuation_opening_service_pick";
  const menuFooter = salesFlowMenuFooter(input.knowledge);
  const contentLang = resolveBusinessContentLanguageFromKnowledge(input.knowledge);
  if (isMetaCloudPhoneNumberId(input.msg.toNumber) && resolveMetaAccessToken()) {
    await sendWhatsAppTextOrMenu(input.msg.toNumber, input.msg.from, body, labels, input.accountSid, input.authToken, {
      footerHint: menuFooter,
      language: contentLang,
    }).catch((e) => console.error("[WA Webhook] Send service pick menu (Meta) failed:", e));
  } else {
    const numbered = labels.map((l, i) => `${i + 1}. ${l}`).join("\n");
    const full = `${body}\n\n${numbered}`;
    await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, full, input.accountSid, input.authToken).catch((e) =>
      console.error("[WA Webhook] Send service pick menu (Twilio) failed:", e)
    );
  }
  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: formatInteractiveConversationLog(split.logBody, labels, menuFooter),
    model_used: modelUsed,
    session_id: input.sessionId,
  });
  return true;
}

/** טקסט חופשי — אימון אחר ממה שנבחר בכפתורים: הודעת אישור + תפריט; איפוס מועד; בחירה חדשה מעדכנת event לדיווח. */
async function sendSalesFlowServiceRepickAckAndMenu(input: {
  knowledge: BusinessKnowledgePack;
  salesFlowServices: SfServiceRow[];
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  blockMedia?: boolean;
  logModelUsed: string;
}): Promise<void> {
  await sendWhatsAppMessage(
    input.msg.toNumber,
    input.msg.from,
    SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE,
    input.accountSid,
    input.authToken
  ).catch((e) => console.error("[WA Webhook] Send service-repick ack failed:", e));
  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE,
    model_used: "sales_flow_service_repick_ack",
    session_id: input.sessionId,
  });

  const phoneVariants = contactPhoneLookupVariants(input.msg.from);
  await input.supabase
    .from("contacts")
    .update(salesFlowOpeningResetPatch())
    .eq("business_id", input.businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [input.msg.from]);

  await sendOpeningServicePickMenu({
    knowledge: input.knowledge,
    salesFlowServices: input.salesFlowServices,
    msg: input.msg,
    accountSid: input.accountSid,
    authToken: input.authToken,
    business_slug: input.business_slug,
    sessionId: input.sessionId,
    blockMedia: input.blockMedia,
    skipScheduleBoard: true,
    modelUsed: input.logModelUsed,
  });
}

async function commitImplicitServiceSwitch(input: {
  knowledge: BusinessKnowledgePack;
  salesFlowServices: SfServiceRow[];
  serviceName: string;
  msg: Pick<WaIncomingMessage, "from">;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
}): Promise<HeyzoeSessionPhase> {
  const picked =
    input.salesFlowServices.find((s) => s.name === input.serviceName) ??
    input.salesFlowServices.find((s) => waLabelMatches(s.name, input.serviceName)) ??
    null;
  const nextPhase = scheduleSelectionPhaseAfterService(input.knowledge, picked);
  const phoneVariants = contactPhoneLookupVariants(input.msg.from);
  await input.supabase
    .from("contacts")
    .update(
      withWarmupExtraAwaitingOff({
        session_phase: nextPhase,
        flow_step: 0,
        sf_requested_date: null,
        sf_requested_time: null,
      })
    )
    .eq("business_id", input.businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [input.msg.from]);
  await logMessage({
    business_slug: input.business_slug,
    role: "event",
    content: `${HEYZOE_SF_SERVICE_PREFIX}${input.serviceName}`,
    model_used: "sf_service_implicit_switch",
    session_id: input.sessionId,
  });
  return nextPhase;
}

async function sendScheduleSlotPickMenu(input: {
  knowledge: BusinessKnowledgePack;
  selectedService: SfServiceRow | null;
  blockMedia?: boolean;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
}): Promise<void> {
  const slots = (input.selectedService?.scheduleSlots ?? []).slice(0, SCHEDULE_SLOT_PICK_MAX);
  if (!slots.length) {
    await sendScheduleSelectionDateQuestion({
      knowledge: input.knowledge,
      selectedService: input.selectedService,
      msg: input.msg,
      accountSid: input.accountSid,
      authToken: input.authToken,
      supabase: input.supabase,
      businessId: input.businessId,
      business_slug: input.business_slug,
      sessionId: input.sessionId,
    });
    return;
  }

  const labels = slots
    .slice(0, Math.max(0, SCHEDULE_SLOT_PICK_MAX - 1))
    .map((s) => formatSlotPickButtonLabelWithCycle(s, { start_date: s.cycle_start, end_date: s.cycle_end }));
  labels.push(SCHEDULE_PICK_CHANGE_SERVICE_LABEL);
  const serviceName = input.selectedService?.name?.trim() || "האימון";
  const body = stripTrailingNumberedChoiceLines(buildScheduleSlotPickQuestion(serviceName));

  const menuFooter = salesFlowMenuFooter(input.knowledge);
  const contentLang = resolveBusinessContentLanguageFromKnowledge(input.knowledge);
  let outboundLog = body;
  if (isMetaCloudPhoneNumberId(input.msg.toNumber) && resolveMetaAccessToken()) {
    await sendWhatsAppTextOrMenu(input.msg.toNumber, input.msg.from, body, labels, input.accountSid, input.authToken, {
      footerHint: menuFooter,
      language: contentLang,
    });
    outboundLog = formatInteractiveConversationLog(body, labels, menuFooter);
  } else {
    const numbered = ["בחרו מועד — כתבו את המספר מהרשימה:", ...labels.map((l, i) => `${i + 1}. ${l}`)].join("\n");
    const full = `${body}\n\n${numbered}`;
    await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, full, input.accountSid, input.authToken).catch((e) =>
      console.error("[WA Webhook] Send schedule slot pick (Twilio) failed:", e)
    );
    outboundLog = full;
  }

  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: outboundLog,
    model_used: "sales_flow_schedule_slot_menu",
    session_id: input.sessionId,
  });
  await updateContactSessionPhase({
    supabase: input.supabase,
    businessId: input.businessId,
    phone: input.msg.from,
    phase: "schedule_date",
  });
}

async function sendCourseCycleStartPickMenu(input: {
  knowledge: BusinessKnowledgePack;
  selectedService: SfServiceRow | null;
  blockMedia?: boolean;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
}): Promise<void> {
  const service = input.selectedService;
  const cycles = service?.courseCycles ?? [];
  const cyclesForButtons = courseCyclesForStartButtons(cycles).slice(0, SCHEDULE_SLOT_PICK_MAX - 1);
  const serviceName = service?.name?.trim() || "הקורס";
  const cfg = input.knowledge.salesFlowConfig;
  const infoText = buildCourseScheduleInfoMessage(serviceName, cycles);
  const introParts = [infoText].filter(Boolean);
  const pickQuestion = resolveCourseCyclePickQuestion(cfg);

  if (cyclesForButtons.length === 0) {
    const txtOnly = [...introParts, pickQuestion.replace(/\?$/, ""), "נשמח לעזור לבחור מחזור מתאים."].filter(Boolean).join("\n\n");
    await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, txtOnly, input.accountSid, input.authToken).catch((e) =>
      console.error("[WA Webhook] Send course schedule info (no buttons) failed:", e)
    );
    await logMessage({
      business_slug: input.business_slug,
      role: "assistant",
      content: txtOnly,
      model_used: "sales_flow_course_schedule_info",
      session_id: input.sessionId,
    });
    await updateContactSessionPhase({
      supabase: input.supabase,
      businessId: input.businessId,
      phone: input.msg.from,
      phase: "cta",
    });
    return;
  }

  const labels = cyclesForButtons.map((c) => formatCourseCycleStartButtonLabel(c.start_date));
  labels.push(SCHEDULE_PICK_CHANGE_SERVICE_LABEL);
  const body = stripTrailingNumberedChoiceLines(
    [...introParts, pickQuestion].filter(Boolean).join("\n\n")
  );

  const menuFooter = salesFlowMenuFooter(input.knowledge);
  const contentLang = resolveBusinessContentLanguageFromKnowledge(input.knowledge);
  let outboundLog = body;
  if (isMetaCloudPhoneNumberId(input.msg.toNumber) && resolveMetaAccessToken()) {
    await sendWhatsAppTextOrMenu(input.msg.toNumber, input.msg.from, body, labels, input.accountSid, input.authToken, {
      footerHint: menuFooter,
      language: contentLang,
    });
    outboundLog = formatInteractiveConversationLog(body, labels, menuFooter);
  } else {
    const numbered = ["בחרו מחזור — כתבו את המספר מהרשימה:", ...labels.map((l, i) => `${i + 1}. ${l}`)].join("\n");
    const full = `${body}\n\n${numbered}`;
    await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, full, input.accountSid, input.authToken).catch((e) =>
      console.error("[WA Webhook] Send course cycle start pick (Twilio) failed:", e)
    );
    outboundLog = full;
  }

  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: outboundLog,
    model_used: "sales_flow_course_cycle_start_menu",
    session_id: input.sessionId,
  });
  await updateContactSessionPhase({
    supabase: input.supabase,
    businessId: input.businessId,
    phone: input.msg.from,
    phase: "schedule_date",
  });
}

function getWhatsAppOpeningGreetingTextOnly(k: BusinessKnowledgePack): string {
  if (k.salesFlowConfig) {
    return composeGreeting(
      k.salesFlowConfig,
      k.botName,
      k.businessName,
      k.taglineText || k.businessDescription,
      k.addressText ?? ""
    ).trim();
  }
  const { body } = getWhatsAppOpeningBodyAndMenuLabels(k);
  return body.trim();
}

/** מדיה לתשובת «בחירת סוג האימון» — לפני טקסט, עם השהיה כמו בפתיחה */
async function sendTrialPickMediaIfAllowed(input: {
  blockMedia: boolean;
  mediaUrl: string;
  mediaType: "image" | "video" | "";
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  business_slug: string;
  sessionId: string;
  caption?: string;
}): Promise<void> {
  const url = input.mediaUrl.trim();
  if (!url) return;
  if (input.blockMedia) {
    console.info("[WA Webhook] trial_pick_media skipped (plan blocks media)");
    return;
  }
  const caption = input.caption?.trim();
  const preferredKind: "image" | "video" | undefined =
    input.mediaType === "video" ? "video" : input.mediaType === "image" ? "image" : undefined;
  const sleepAfterMs = (k: "image" | "video" | undefined) =>
    k === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(url) ? 2200 : 1300;

  const logMediaRow = async () => {
    const cap = caption;
    await logMessage({
      business_slug: input.business_slug,
      role: "assistant",
      content: cap ? `[media] ${url}\n\n${cap}` : `[media] ${url}`,
      model_used: "trial_pick_media",
      session_id: input.sessionId,
    });
  };

  const sendOnce = async (kind: "image" | "video" | undefined) => {
    await sendWhatsAppMediaMessage(
      input.msg.toNumber,
      input.msg.from,
      url,
      input.accountSid,
      input.authToken,
      caption || undefined,
      kind
    );
  };

  try {
    await sendOnce(preferredKind);
    await logMediaRow();
    await sleepMs(sleepAfterMs(preferredKind));
    return;
  } catch (e1) {
    console.error("[WA Webhook] trial_pick_media send failed (primary):", {
      provider: isMetaCloudPhoneNumberId(String(input.msg.toNumber ?? "").trim()) ? "meta" : "twilio",
      preferredKind,
      urlHost: (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return "invalid-url";
        }
      })(),
      e: e1,
    });
  }

  try {
    await sleepMs(280);
    await sendOnce(undefined);
    await logMediaRow();
    await sleepMs(sleepAfterMs(undefined));
    return;
  } catch (e2) {
    console.error("[WA Webhook] trial_pick_media send failed (retry auto kind):", e2);
  }

  const flipped: "image" | "video" =
    preferredKind === "video" ? "image" : preferredKind === "image" ? "video" : "video";
  try {
    await sleepMs(280);
    await sendOnce(flipped);
    await logMediaRow();
    await sleepMs(flipped === "video" ? 2200 : 1300);
    return;
  } catch (e3) {
    console.error("[WA Webhook] trial_pick_media send failed (retry flipped kind):", {
      url,
      preferredKind,
      e: e3,
    });
  }
}

async function sendSalesFlowCtaMenuWithPhaseUpdate(input: {
  knowledge: BusinessKnowledgePack;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  salesFlowServices: SfServiceRow[];
  trialRegistered: boolean | null;
  allowTrialCta: boolean;
  sfConsumedKinds?: string[];
  extraBodyLines?: string[];
  modelUsed: string;
  blockMedia?: boolean;
}): Promise<void> {
  const {
    knowledge,
    msg,
    accountSid,
    authToken,
    supabase,
    businessId,
    business_slug,
    sessionId,
    salesFlowServices,
    trialRegistered,
    allowTrialCta,
    sfConsumedKinds,
    extraBodyLines,
    modelUsed,
    blockMedia = false,
  } = input;
  const cfg = knowledge.salesFlowConfig;
  if (!cfg || !businessId) return;

  const sfEff: EffectiveSalesFlowCtaInput = {
    trialRegistered,
    allowTrialCta,
    consumedNonTrialKinds: new Set(sfConsumedKinds ?? []),
  };

  const selectedServiceName =
    salesFlowServices.length === 1
      ? salesFlowServices[0]!.name
      : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
  const selectedService =
    salesFlowServices.find((s) => s.name === selectedServiceName) ?? salesFlowServices[0] ?? null;

  if (shouldCollectCourseCycleStartPick(knowledge, selectedService)) {
    const scheduleState = await fetchContactScheduleSelectionState({ supabase, businessId, phone: msg.from });
    if (!scheduleState.requestedDate?.trim()) {
      await sendCourseCycleStartPickMenu({
        knowledge,
        selectedService,
        blockMedia,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
      return;
    }
  }

  if (shouldCollectScheduleSelection(knowledge, selectedService)) {
    const scheduleState = await fetchContactScheduleSelectionState({ supabase, businessId, phone: msg.from });
    const slots = selectedService?.scheduleSlots ?? [];
    if (slots.length > 0) {
      if (!scheduleState.requestedDate || !scheduleState.requestedTime) {
        await sendScheduleSlotPickMenu({
          knowledge,
          selectedService,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
        });
        return;
      }
    } else {
      if (!scheduleState.requestedDate) {
        await sendScheduleSelectionDateQuestion({
          knowledge,
          selectedService,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
        });
        return;
      }
      if (!scheduleState.requestedTime) {
        await sendScheduleSelectionTimeQuestion({
          selectedService,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
        });
        return;
      }
    }
  }

  const activeOfferKind = selectedService?.offerKind ?? "trial";

  const inScheduleTrialFlow =
    activeOfferKind === "trial" && shouldCollectScheduleSelection(knowledge, selectedService);
  const ctaBank = inScheduleTrialFlow
    ? filterTrialCtaButtonsAfterSchedule(ctaButtonsForOfferKind(cfg, activeOfferKind))
    : ctaButtonsForOfferKind(cfg, activeOfferKind);
  const filtered =
    activeOfferKind === "trial"
      ? getEffectiveSalesFlowCtaButtons(ctaBank, sfEff)
      : getEffectiveSecondaryOfferCtaButtons(ctaBank, sfConsumedKinds ?? []);

  const ctaLabels = filtered.map((b) => b.label.trim()).filter((l) => l.length > 0).slice(0, 12);

  let pickedCycleStartForCta = "";
  if (activeOfferKind === "course") {
    const st = await fetchContactScheduleSelectionState({ supabase, businessId, phone: msg.from });
    pickedCycleStartForCta = st.requestedDate?.trim() ?? "";
  }

  const { priceText: ctaPriceText, durationText: ctaDurationText } = resolveSfServicePriceDuration(
    selectedService,
    salesFlowServices
  );
  const baseCtaBody = inScheduleTrialFlow
    ? fillCtaBodyTemplate(resolveTrialCtaBodyTemplate(cfg, true), ctaPriceText, ctaDurationText)
    : fillOfferKindCtaBody(activeOfferKind, cfg, {
        ...courseCtaFillFromService(selectedService, pickedCycleStartForCta || undefined),
        priceText: ctaPriceText,
        durationText: ctaDurationText,
      }).trim();

  const lastAssistModelForPromo = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
  const promo = knowledge?.promotionsText?.trim() ?? "";
  const promoIsTrial = promo && /(אימון|שיעור)\s*ניסיון|ניסיון/u.test(promo);
  const shouldAttachTrialPromo =
    activeOfferKind === "trial" &&
    trialRegistered !== true &&
    promoIsTrial &&
    lastAssistModelForPromo !== "sales_flow_cta";

  const ctaBody = [
    shouldAttachTrialPromo ? appendTrialPromotionToCtaBody(baseCtaBody, promo) : baseCtaBody,
    ...(extraBodyLines ?? []).map((x) => String(x ?? "").trim()).filter(Boolean),
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!ctaBody) return;

  const contentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
  const menuFooter = getZoeWhatsAppMenuFooter(contentLang);

  if (ctaLabels.length >= 1) {
    await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, ctaBody, ctaLabels, accountSid, authToken, {
      footerHint: menuFooter,
      language: contentLang,
    }).catch((e) => console.error("[WA Webhook] sendSalesFlowCtaMenu failed:", e));
  } else {
    await sendWhatsAppMessage(msg.toNumber, msg.from, `${ctaBody}\n\n${menuFooter}`, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] sendSalesFlowCtaMenu plain failed:", e)
    );
  }

  await logMessage({
    business_slug,
    role: "assistant",
    content: formatInteractiveConversationLog(ctaBody, ctaLabels, menuFooter),
    model_used: modelUsed,
    session_id: sessionId,
  });

  // One-time CTA note per "flow run" (resets on greeting/opening).
  // We persist the marker in messages to avoid adding more DB columns.
  const CTA_NOTE_MODEL = "sf_cta_note";
  try {
    const { data: markers } = await supabase
      .from("messages")
      .select("model_used, created_at")
      .eq("business_slug", business_slug)
      .eq("session_id", sessionId)
      .eq("role", "assistant")
      .in("model_used", [CTA_NOTE_MODEL, "greeting", "default_opening"])
      .order("created_at", { ascending: false })
      .limit(50);
    const lastResetAt =
      (markers ?? []).find((m: any) => m?.model_used === "greeting" || m?.model_used === "default_opening")?.created_at ??
      null;
    const lastNoteAt = (markers ?? []).find((m: any) => m?.model_used === CTA_NOTE_MODEL)?.created_at ?? null;
    const shouldSendNote =
      !lastNoteAt || (lastResetAt && String(lastNoteAt) < String(lastResetAt));
    if (shouldSendNote) {
      const note = ctaOpenQuestionNote(contentLang);
      await sendWhatsAppMessage(msg.toNumber, msg.from, note, accountSid, authToken).catch((e) =>
        console.error("[WA Webhook] Send CTA note failed:", e)
      );
      await logMessage({
        business_slug,
        role: "assistant",
        content: note,
        model_used: CTA_NOTE_MODEL,
        session_id: sessionId,
      });
    }
  } catch (e) {
    console.warn("[WA Webhook] CTA note check failed (continuing):", e);
  }

  await logMessage({
    business_slug,
    role: "event",
    content: HEYZOE_SF_CTA_REACHED,
    model_used: "sf_cta_reached",
    session_id: sessionId,
  });
  await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: "cta" });
}

/** שאלת חימום «ניסיון קודם» + כפתורי וואטסאפ */
async function sendWarmupExperienceQuestionMenu(input: {
  cfg: import("@/lib/sales-flow").SalesFlowConfig;
  salesFlowServices: SfServiceRow[];
  business_slug: string;
  sessionId: string;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  blockTrialPickMedia: boolean;
  bumpFlowStep: boolean;
  contentLang?: import("@/lib/business-content-lang").BusinessContentLanguage;
}): Promise<boolean> {
  const menu = await buildWarmupExperienceMenu({
    cfg: input.cfg,
    salesFlowServices: input.salesFlowServices,
    fetchLastSfServiceEventName,
    business_slug: input.business_slug,
    session_id: input.sessionId,
  });
  if (!menu) return false;

  const menuFooter = getZoeWhatsAppMenuFooter(input.contentLang ?? "he");

  if (!input.bumpFlowStep) {
    await sendWhatsAppTextOrMenu(
      input.msg.toNumber,
      input.msg.from,
      menu.question,
      menu.options,
      input.accountSid,
      input.authToken,
      { footerHint: menuFooter, language: input.contentLang ?? "he" }
    ).catch((e) => console.error("[WA Webhook] warmup experience menu failed:", e));

    await logMessage({
      business_slug: input.business_slug,
      role: "assistant",
      content: formatInteractiveConversationLog(menu.question, menu.options, menuFooter),
      model_used: WA_WARMUP_EXPERIENCE_SENT_MODEL,
      session_id: input.sessionId,
    });
    return true;
  }

  const cas = await tryClaimWarmupAwaitingSend({
    supabase: input.supabase,
    businessId: input.businessId,
    phone: input.msg.from,
    requireReadIdx: WARMUP_EXTRA_AWAITING_OFF,
    nextIdx: -1,
  });
  if (!cas.advanced) return false;

  const named =
    input.salesFlowServices.length === 1
      ? input.salesFlowServices[0]!.name
      : (await fetchLastSfServiceEventName({ business_slug: input.business_slug, session_id: input.sessionId })) ??
        "";
  const svcRow =
    input.salesFlowServices.length === 1
      ? input.salesFlowServices[0] ?? null
      : input.salesFlowServices.find((s) => s.name === named) ?? null;
  await sendTrialPickMediaIfAllowed({
    blockMedia: input.blockTrialPickMedia,
    mediaUrl: svcRow?.trialPickMediaUrl ?? "",
    mediaType: svcRow?.trialPickMediaType ?? "",
    msg: input.msg,
    accountSid: input.accountSid,
    authToken: input.authToken,
    business_slug: input.business_slug,
    sessionId: input.sessionId,
  }).catch((e) => console.warn("[WA Webhook] warmup Q1 trial pick media failed (continuing):", e));

  try {
    await sendWhatsAppTextOrMenu(
      input.msg.toNumber,
      input.msg.from,
      menu.question,
      menu.options,
      input.accountSid,
      input.authToken,
      { footerHint: menuFooter, language: input.contentLang ?? "he" }
    );
  } catch (e) {
    await rollbackWarmupAwaitingAfterSendFailure({
      supabase: input.supabase,
      businessId: input.businessId,
      phone: input.msg.from,
      readIdx: cas.readIdx,
      nextIdx: cas.nextIdx,
      context: "sendWarmupExperienceQuestionMenu",
      sendError: e,
    });
    return false;
  }

  try {
    await logMessage({
      business_slug: input.business_slug,
      role: "assistant",
      content: formatInteractiveConversationLog(menu.question, menu.options, menuFooter),
      model_used: WA_WARMUP_EXPERIENCE_SENT_MODEL,
      session_id: input.sessionId,
    });
  } catch (e) {
    console.error("[WA Webhook] warmup experience logMessage failed (send succeeded; no CAS rollback):", e);
  }

  try {
    await bumpContactFlowStep({
      supabase: input.supabase,
      businessId: input.businessId,
      phone: input.msg.from,
      nextStep: 1,
    });
  } catch (e) {
    console.warn("[WA Webhook] warmup experience flow_step bump failed (send succeeded; no CAS rollback):", e);
  }
  return true;
}

async function sendFlowContinuation(input: {
  phase: HeyzoeSessionPhase;
  contact: { flow_step: number };
  knowledge: BusinessKnowledgePack;
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  salesFlowServices: SfServiceRow[];
  trialRegistered: boolean | null;
  allowTrialCta: boolean;
  blockTrialPickMedia?: boolean;
  sfConsumedKinds?: string[];
  instagramFollowPromptSent?: boolean;
  /** טקסט נכנס — לדילוג על resend תפריט אימונים ב-opening (בקשת נציג). */
  inboundText?: string;
  /** תשובת Claude לפני resend — לדילוג כשמפנה לשירות לקוחות. */
  aiReplyCoreClean?: string;
}): Promise<void> {
  const {
    phase,
    contact,
    knowledge,
    msg,
    accountSid,
    authToken,
    supabase,
    businessId,
    business_slug,
    sessionId,
    salesFlowServices,
    trialRegistered,
    allowTrialCta,
    blockTrialPickMedia = false,
    sfConsumedKinds,
    instagramFollowPromptSent,
  } = input;
  const cfg = knowledge.salesFlowConfig;
  if (!cfg || !businessId) return;
  const menuFooter = salesFlowMenuFooter(knowledge);
  const contentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);

  if (phase === "registered") {
    const igRaw = knowledge.instagramUrl?.trim();
    const includeIg = Boolean(igRaw?.length) && !instagramFollowPromptSent;
    const parts = [
      includeIg && igRaw ? instagramFollowLine(contentLang, igRaw) : "",
      registeredFlowContinuationClosing(contentLang),
    ].filter(Boolean);
    const txt = parts.join("\n\n").trim();
    if (!txt) return;
    await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] flow continuation registered failed:", e)
    );
    await logMessage({
      business_slug,
      role: "assistant",
      content: txt,
      model_used: "flow_continuation_registered_soft",
      session_id: sessionId,
    });
    if (businessId && includeIg) {
      const igUp = await supabase
        .from("contacts")
        .update({ instagram_follow_prompt_sent: true })
        .eq("business_id", businessId)
        .eq("phone", msg.from);
      if (igUp.error) console.warn("[WA Webhook] instagram_follow_prompt_sent (continuation):", igUp.error.message);
    }
    return;
  }

  if (phase === "schedule_date") {
    const selectedServiceName =
      salesFlowServices.length === 1
        ? salesFlowServices[0]!.name
        : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
    const selectedService =
      salesFlowServices.find((s) => s.name === selectedServiceName) ?? salesFlowServices[0] ?? null;
    if (shouldCollectCourseCycleStartPick(knowledge, selectedService)) {
      await sendCourseCycleStartPickMenu({
        knowledge,
        selectedService,
        blockMedia: blockTrialPickMedia,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
    } else if ((selectedService?.scheduleSlots?.length ?? 0) > 0) {
      await sendScheduleSlotPickMenu({
        knowledge,
        selectedService,
        blockMedia: blockTrialPickMedia,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
    } else {
      await sendScheduleSelectionDateQuestion({
        knowledge,
        selectedService,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
    }
    return;
  }

  if (phase === "schedule_time") {
    const selectedServiceName =
      salesFlowServices.length === 1
        ? salesFlowServices[0]!.name
        : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
    const selectedService =
      salesFlowServices.find((s) => s.name === selectedServiceName) ?? salesFlowServices[0] ?? null;
    if (shouldCollectCourseCycleStartPick(knowledge, selectedService)) {
      await sendCourseCycleStartPickMenu({
        knowledge,
        selectedService,
        blockMedia: blockTrialPickMedia,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
    } else if ((selectedService?.scheduleSlots?.length ?? 0) > 0) {
      await sendScheduleSlotPickMenu({
        knowledge,
        selectedService,
        blockMedia: blockTrialPickMedia,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
    } else {
      await sendScheduleSelectionTimeQuestion({
        selectedService,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
    }
    return;
  }

  if (phase === "cta") {
    await sendSalesFlowCtaMenuWithPhaseUpdate({
      knowledge,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      salesFlowServices,
      trialRegistered,
      allowTrialCta,
      sfConsumedKinds,
      modelUsed: "flow_continuation_cta",
    });
    return;
  }

  if (phase === "warmup") {
    if (knowledge.warmupSessionEnabled === false) {
      await advanceAfterWarmupSessionComplete({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        blockTrialPickMedia,
        trialRegistered,
        allowTrialCta,
        sfConsumedKinds,
        instagramFollowPromptSent,
      });
      return;
    }
    const pendingExp = await isWarmupExperienceQuestionPending({
      admin: supabase,
      business_slug,
      session_id: sessionId,
    });
    if (pendingExp) {
      const resent = await sendWarmupExperienceQuestionMenu({
        cfg,
        salesFlowServices,
        business_slug,
        sessionId,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        blockTrialPickMedia,
        bumpFlowStep: false,
        contentLang: resolveBusinessContentLanguageFromKnowledge(knowledge),
      });
      if (resent) return;
    }
  }

  const step = Number.isFinite(contact.flow_step) ? contact.flow_step : 0;

  if (phase === "opening") {
    const extras = Array.isArray(cfg.greeting_extra_steps) ? cfg.greeting_extra_steps : [];
    const cleanGreeting = extras
      .map((s) => ({
        question: String((s as any)?.question ?? "").trim(),
        options: Array.isArray((s as any)?.options)
          ? (s as any).options.map((x: any) => String(x ?? "").trim()).filter(Boolean)
          : [],
      }))
      .filter((s) => s.question && s.options.length >= 2);

    if (step < cleanGreeting.length) {
      const st = cleanGreeting[step]!;
      await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, st.question, st.options, accountSid, authToken, {
        footerHint: menuFooter,
        language: contentLang,
      }).catch((e) => console.error("[WA Webhook] flow continuation opening extra failed:", e));
      await logMessage({
        business_slug,
        role: "assistant",
        content: formatInteractiveConversationLog(st.question, st.options, menuFooter),
        model_used: "flow_continuation_opening_extra",
        session_id: sessionId,
      });
      await bumpContactFlowStep({ supabase, businessId, phone: msg.from, nextStep: step + 1 });
      return;
    }

    if (knowledge.warmupSessionEnabled === false) {
      await advanceAfterWarmupSessionComplete({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        blockTrialPickMedia,
        trialRegistered,
        allowTrialCta,
        sfConsumedKinds,
        instagramFollowPromptSent,
      });
      return;
    }

    const warmupAlreadyComplete = await isWarmupFlowCompleteForRecovery({
      knowledge,
      salesFlowServices,
      cfg,
      flowStep: step,
      business_slug,
      sessionId,
      supabase,
    });
    if (warmupAlreadyComplete) {
      await advanceAfterWarmupSessionComplete({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        blockTrialPickMedia,
        trialRegistered,
        allowTrialCta,
        sfConsumedKinds,
        instagramFollowPromptSent,
      });
      return;
    }

    await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: "warmup" });
    await sendFlowContinuation({
      phase: "warmup",
      contact: { flow_step: 0 },
      knowledge,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      salesFlowServices,
      trialRegistered,
      allowTrialCta,
      blockTrialPickMedia,
      sfConsumedKinds,
      instagramFollowPromptSent,
    });
    return;
  }

  if (phase === "warmup") {
    if (knowledge.warmupSessionEnabled === false) {
      await advanceAfterWarmupSessionComplete({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        blockTrialPickMedia,
        trialRegistered,
        allowTrialCta,
        sfConsumedKinds,
        instagramFollowPromptSent,
      });
      return;
    }
    const wbWarm = resolveWarmupExperienceConfig(cfg);
    const { cleanSteps: cleanWarm, hasWarmupQ1 } = buildWarmupExtraCleanStepsFromWb(wbWarm);

    if (step === 0 && hasWarmupQ1) {
      const sent = await sendWarmupExperienceQuestionMenu({
        cfg,
        salesFlowServices,
        business_slug,
        sessionId,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        blockTrialPickMedia,
        bumpFlowStep: true,
        contentLang: resolveBusinessContentLanguageFromKnowledge(knowledge),
      });
      if (sent) return;
    }

    const extraIdx = hasWarmupQ1 ? step - 1 : step;
    const st = extraIdx >= 0 ? cleanWarm[extraIdx] : undefined;
    if (st) {
      const cas = await tryClaimWarmupAwaitingSend({
        supabase,
        businessId,
        phone: msg.from,
        requireReadIdx: WARMUP_EXTRA_AWAITING_OFF,
        nextIdx: extraIdx,
      });
      if (!cas.advanced) return;

      try {
        await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, st.question, st.options, accountSid, authToken, {
          footerHint: menuFooter,
          language: contentLang,
        });
      } catch (e) {
        await rollbackWarmupAwaitingAfterSendFailure({
          supabase,
          businessId,
          phone: msg.from,
          readIdx: cas.readIdx,
          nextIdx: cas.nextIdx,
          context: "sendFlowContinuation_warmup_extra",
          sendError: e,
        });
        return;
      }

      try {
        await logMessage({
          business_slug,
          role: "assistant",
          content: formatInteractiveConversationLog(st.question, st.options, menuFooter),
          model_used: "flow_continuation_warmup_extra",
          session_id: sessionId,
        });
        await logMessage({
          business_slug,
          role: "event",
          content: `${HEYZOE_SF_WARMUP_EXTRA_PREFIX}${extraIdx}`,
          model_used: "sf_warmup_extra",
          session_id: sessionId,
        });
      } catch (e) {
        console.error(
          "[WA Webhook] flow continuation warmup extra log failed (send succeeded; no CAS rollback):",
          e
        );
      }

      try {
        await bumpContactFlowStep({ supabase, businessId, phone: msg.from, nextStep: step + 1 });
      } catch (e) {
        console.warn(
          "[WA Webhook] flow continuation warmup extra flow_step bump failed (send succeeded; no CAS rollback):",
          e
        );
      }
      return;
    }

    await advanceAfterWarmupSessionComplete({
      knowledge,
      salesFlowServices,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      blockTrialPickMedia,
      trialRegistered,
      allowTrialCta,
      sfConsumedKinds,
      instagramFollowPromptSent,
    });
  }
}

type DeterministicFlowRecoveryInput = {
  phase: HeyzoeSessionPhase;
  flowStep: number;
  knowledge: BusinessKnowledgePack;
  salesFlowServices: SfServiceRow[];
  msg: Pick<WaIncomingMessage, "toNumber" | "from">;
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  blockTrialPickMedia: boolean;
  trialRegistered: boolean | null;
  allowTrialCta: boolean;
  sfConsumedKinds: string[];
  instagramFollowPromptSent: boolean;
  scheduleRequestedDate: string;
  scheduleRequestedTime: string;
};

async function isWarmupFlowCompleteForRecovery(input: {
  knowledge: BusinessKnowledgePack;
  salesFlowServices: SfServiceRow[];
  cfg: import("@/lib/sales-flow").SalesFlowConfig;
  flowStep: number;
  business_slug: string;
  sessionId: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
}): Promise<boolean> {
  if (input.knowledge.warmupSessionEnabled === false) return true;

  const named =
    input.salesFlowServices.length === 1
      ? input.salesFlowServices[0]?.name ?? ""
      : ((await fetchLastSfServiceEventName({ business_slug: input.business_slug, session_id: input.sessionId })) ??
        "");
  const svcRow =
    input.salesFlowServices.length === 1
      ? input.salesFlowServices[0] ?? null
      : input.salesFlowServices.find((s) => s.name === named) ?? null;
  const wb = resolveWarmupExperienceConfig(input.cfg);
  const hasWarmupQ1 = isWarmupExperienceQuestion1Configured(wb);
  const cleanWarm = wb.extras
    .map((s) => ({
      question: String((s as { question?: unknown }).question ?? "").trim(),
      options: Array.isArray((s as { options?: unknown }).options)
        ? (s as { options: unknown[] }).options.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [],
    }))
    .filter((s) => s.question && s.options.length >= 2);

  if (hasWarmupQ1) {
    const pending = await isWarmupExperienceQuestionPending({
      admin: input.supabase,
      business_slug: input.business_slug,
      session_id: input.sessionId,
    });
    if (pending) return false;
    const sent = await wasWarmupExperienceQuestionSentSinceReset({
      admin: input.supabase,
      business_slug: input.business_slug,
      session_id: input.sessionId,
    });
    if (!sent) return false;
  }

  if (cleanWarm.length === 0) return true;

  const lastIdx = await fetchLastSfWarmupExtraIndex({
    business_slug: input.business_slug,
    session_id: input.sessionId,
  });
  // אירוע sf_warmup_extra מסמן איזו שאלה נשלחה — סיום רק אחרי שענו על כולן (index >= מספר השאלות).
  if (lastIdx != null) return lastIdx >= cleanWarm.length;

  const lastAssist = await fetchLastAssistantModelUsed({
    business_slug: input.business_slug,
    session_id: input.sessionId,
  });
  if (isWarmupExtraMenuModel(lastAssist)) return false;

  const minStep = (hasWarmupQ1 ? 1 : 0) + cleanWarm.length;
  return input.flowStep >= minStep;
}

/** אחרי תשובת Claude לטקסט חופשי — שולח מחדש את השאלה/תפריט שעדיין ממתין (בלי advance גנרי). */
async function resendUnansweredSalesFlowPrompt(
  input: Parameters<typeof sendFlowContinuation>[0]
): Promise<void> {
  const {
    phase,
    contact,
    knowledge,
    msg,
    accountSid,
    authToken,
    supabase,
    businessId,
    business_slug,
    sessionId,
    salesFlowServices,
    blockTrialPickMedia,
  } = input;
  const cfg = knowledge.salesFlowConfig;
  if (!cfg || !businessId) return;
  const menuFooter = salesFlowMenuFooter(knowledge);
  const contentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);

  const step = Number.isFinite(contact.flow_step) ? contact.flow_step : 0;

  if (phase === "opening") {
    const extras = Array.isArray(cfg.greeting_extra_steps) ? cfg.greeting_extra_steps : [];
    const cleanGreeting = extras
      .map((s) => ({
        question: String((s as { question?: unknown }).question ?? "").trim(),
        options: Array.isArray((s as { options?: unknown }).options)
          ? (s as { options: unknown[] }).options.map((x) => String(x ?? "").trim()).filter(Boolean)
          : [],
      }))
      .filter((s) => s.question && s.options.length >= 2);

    if (step < cleanGreeting.length) {
      const st = cleanGreeting[step]!;
      await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, st.question, st.options, accountSid, authToken, {
        footerHint: menuFooter,
        language: contentLang,
      }).catch((e) => console.error("[WA Webhook] resend opening extra failed:", e));
      await logMessage({
        business_slug,
        role: "assistant",
        content: formatInteractiveConversationLog(st.question, st.options, menuFooter),
        model_used: "sales_flow_opening_extra_resend",
        session_id: sessionId,
      });
      return;
    }

    const lastService =
      salesFlowServices.length === 1
        ? salesFlowServices[0]!.name
        : ((await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "");
    if (salesFlowServices.length > 1 && !lastService.trim()) {
      if (
        shouldSkipSalesFlowPromptResend({
          inboundText: input.inboundText,
          aiReplyCoreClean: input.aiReplyCoreClean,
          knowledge,
        })
      ) {
        return;
      }

      const skipScheduleBoard = await wasScheduleBoardSentInSession({ supabase, business_slug, sessionId });
      await sendOpeningServicePickMenu({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        business_slug,
        sessionId,
        blockMedia: blockTrialPickMedia,
        skipScheduleBoard,
        modelUsed: "sales_flow_opening_service_pick_resend",
      });
    }
    return;
  }

  if (phase === "warmup") {
    if (knowledge.warmupSessionEnabled === false) return;

    const pendingExp = await isWarmupExperienceQuestionPending({
      admin: supabase,
      business_slug,
      session_id: sessionId,
    });
    if (pendingExp) {
      await sendWarmupExperienceQuestionMenu({
        cfg,
        salesFlowServices,
        business_slug,
        sessionId,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        blockTrialPickMedia: blockTrialPickMedia ?? false,
        bumpFlowStep: false,
        contentLang: resolveBusinessContentLanguageFromKnowledge(knowledge),
      });
      return;
    }

    const wbWarm = resolveWarmupExperienceConfig(cfg);
    const { cleanSteps: cleanWarm, hasWarmupQ1 } = buildWarmupExtraCleanStepsFromWb(wbWarm);
    const lastIdxFromEvent = await fetchLastSfWarmupExtraIndex({ business_slug, session_id: sessionId });
    const lastAssist = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
    const resendDecision = decideWarmupExtraResendAction({
      contactFlowStep: step,
      lastIdxFromEvent,
      lastAssistModel: lastAssist,
      hasWarmupQ1,
      cleanStepsCount: cleanWarm.length,
    });
    const extraIdx = resendDecision.action === "send" ? resendDecision.targetExtraIdx : null;
    const st = extraIdx != null ? cleanWarm[extraIdx] : undefined;
    if (st?.question && (st.options?.length ?? 0) >= 2) {
      const opts = st.options.map((o) => String(o ?? "").trim()).filter(Boolean);
      await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, st.question, opts, accountSid, authToken, {
        footerHint: menuFooter,
        language: contentLang,
      }).catch((e) => console.error("[WA Webhook] resend warmup extra failed:", e));
      await logMessage({
        business_slug,
        role: "assistant",
        content: formatInteractiveConversationLog(st.question, opts, menuFooter),
        model_used: "sales_flow_warmup_extra_resend",
        session_id: sessionId,
      });
      return;
    }

    if (hasWarmupQ1) {
      await sendWarmupExperienceQuestionMenu({
        cfg,
        salesFlowServices,
        business_slug,
        sessionId,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        blockTrialPickMedia: blockTrialPickMedia ?? false,
        bumpFlowStep: false,
        contentLang: resolveBusinessContentLanguageFromKnowledge(knowledge),
      });
    }
    return;
  }

  if (phase === "schedule_date" || phase === "schedule_time") {
    if (
      shouldSkipSalesFlowPromptResend({
        inboundText: input.inboundText,
        aiReplyCoreClean: input.aiReplyCoreClean,
        knowledge,
      })
    ) {
      return;
    }

    const selectedServiceName =
      salesFlowServices.length === 1
        ? salesFlowServices[0]!.name
        : ((await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "");
    const selectedService =
      salesFlowServices.find((s) => s.name === selectedServiceName) ?? salesFlowServices[0] ?? null;

    if (shouldCollectCourseCycleStartPick(knowledge, selectedService)) {
      await sendCourseCycleStartPickMenu({
        knowledge,
        selectedService,
        blockMedia: blockTrialPickMedia,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
      return;
    }

    if ((selectedService?.scheduleSlots?.length ?? 0) > 0) {
      await sendScheduleSlotPickMenu({
        knowledge,
        selectedService,
        blockMedia: blockTrialPickMedia,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
      return;
    }

    if (phase === "schedule_date") {
      await sendScheduleSelectionDateQuestion({
        knowledge,
        selectedService,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
    } else {
      await sendScheduleSelectionTimeQuestion({
        selectedService,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
      });
    }
  }
}

async function continueDeterministicFlowAfterFreeTextAi(
  input: Parameters<typeof sendFlowContinuation>[0]
): Promise<void> {
  await resendUnansweredSalesFlowPrompt(input);
}

/**
 * שחזור פלואו דטרמיניסטי לפני Claude — רק כשהודעה לא עברה כ-isFreeTextSalesFlowAi
 * (כפתור/בחירה שלא זוהתה, לא שאלה פתוחה).
 */
async function tryRecoverDeterministicSalesFlowOnRecognitionMiss(
  input: DeterministicFlowRecoveryInput
): Promise<boolean> {
  const cfg = input.knowledge.salesFlowConfig;
  if (!cfg || !input.businessId) return false;
  if (!SALES_FLOW_DETERMINISTIC_PHASES.has(input.phase)) return false;

  const step = Number.isFinite(input.flowStep) ? input.flowStep : 0;
  const flowBase = {
    knowledge: input.knowledge,
    salesFlowServices: input.salesFlowServices,
    msg: input.msg,
    accountSid: input.accountSid,
    authToken: input.authToken,
    supabase: input.supabase,
    businessId: input.businessId,
    business_slug: input.business_slug,
    sessionId: input.sessionId,
    blockTrialPickMedia: input.blockTrialPickMedia,
    trialRegistered: input.trialRegistered,
    allowTrialCta: input.allowTrialCta,
    sfConsumedKinds: input.sfConsumedKinds,
    instagramFollowPromptSent: input.instagramFollowPromptSent,
  };

  try {
    if (input.phase === "opening") {
      const cleanGreeting = (Array.isArray(cfg.greeting_extra_steps) ? cfg.greeting_extra_steps : [])
        .map((s) => ({
          question: String((s as { question?: unknown }).question ?? "").trim(),
          options: Array.isArray((s as { options?: unknown }).options)
            ? (s as { options: unknown[] }).options.map((x) => String(x ?? "").trim()).filter(Boolean)
            : [],
        }))
        .filter((s) => s.question && s.options.length >= 2);
      if (step < cleanGreeting.length) return false;

      if (input.knowledge.warmupSessionEnabled === false) {
        await advanceAfterWarmupSessionComplete(flowBase);
        return true;
      }
      const warmupAlreadyComplete = await isWarmupFlowCompleteForRecovery({
        knowledge: input.knowledge,
        salesFlowServices: input.salesFlowServices,
        cfg,
        flowStep: step,
        business_slug: input.business_slug,
        sessionId: input.sessionId,
        supabase: input.supabase,
      });
      if (warmupAlreadyComplete) {
        await advanceAfterWarmupSessionComplete(flowBase);
        return true;
      }
      await updateContactSessionPhase({
        supabase: input.supabase,
        businessId: input.businessId,
        phone: input.msg.from,
        phase: "warmup",
      });
      await sendFlowContinuation({
        phase: "warmup",
        contact: { flow_step: 0 },
        ...flowBase,
      });
      return true;
    }

    if (input.phase === "warmup") {
      const warmComplete = await isWarmupFlowCompleteForRecovery({
        knowledge: input.knowledge,
        salesFlowServices: input.salesFlowServices,
        cfg,
        flowStep: step,
        business_slug: input.business_slug,
        sessionId: input.sessionId,
        supabase: input.supabase,
      });
      if (!warmComplete) return false;
      await advanceAfterWarmupSessionComplete(flowBase);
      return true;
    }

    if (input.phase === "schedule_date" || input.phase === "schedule_time") {
      const selectedServiceName =
        input.salesFlowServices.length === 1
          ? input.salesFlowServices[0]!.name
          : ((await fetchLastSfServiceEventName({
              business_slug: input.business_slug,
              session_id: input.sessionId,
            })) ?? "");
      const selectedService =
        input.salesFlowServices.find((s) => s.name === selectedServiceName) ??
        input.salesFlowServices[0] ??
        null;
      const needsSchedule =
        shouldCollectScheduleSelection(input.knowledge, selectedService) ||
        shouldCollectCourseCycleStartPick(input.knowledge, selectedService);
      if (!needsSchedule) {
        await updateContactSessionPhase({
          supabase: input.supabase,
          businessId: input.businessId,
          phone: input.msg.from,
          phase: "cta",
        });
        await sendFlowContinuation({
          phase: "cta",
          contact: { flow_step: 0 },
          ...flowBase,
        });
        return true;
      }

      const date = input.scheduleRequestedDate.trim();
      const time = input.scheduleRequestedTime.trim();
      const slots = selectedService?.scheduleSlots ?? [];
      if (slots.length > 0) {
        if (!date || !time) return false;
      } else if (!date) {
        return false;
      } else if (!time && input.phase === "schedule_date") {
        await updateContactSessionPhase({
          supabase: input.supabase,
          businessId: input.businessId,
          phone: input.msg.from,
          phase: "schedule_time",
        });
        await sendFlowContinuation({
          phase: "schedule_time",
          contact: { flow_step: 0 },
          ...flowBase,
        });
        return true;
      } else if (!time) {
        return false;
      }

      await updateContactSessionPhase({
        supabase: input.supabase,
        businessId: input.businessId,
        phone: input.msg.from,
        phase: "cta",
      });
      await sendFlowContinuation({
        phase: "cta",
        contact: { flow_step: 0 },
        ...flowBase,
      });
      return true;
    }
  } catch (e) {
    console.error("[WA Webhook] tryRecoverDeterministicSalesFlowOnRecognitionMiss failed:", e);
    return false;
  }

  return false;
}

type AccountUpdateEvent = {
  waba_id: string;
  event: string;
  value: Record<string, unknown>;
};

/**
 * Parses Meta `account_update` webhook payloads.
 * Per Meta docs: `entry.id` is the business portfolio ID; customer WABA ID is
 * `changes[].value.waba_info.waba_id`; event name is `changes[].value.event`.
 */
export function parseAccountUpdate(payload: unknown): AccountUpdateEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account") return null;

  const entries = Array.isArray(root.entry) ? root.entry : [];
  for (const entry of entries) {
    const ent = entry as Record<string, unknown>;
    const changes = Array.isArray(ent.changes) ? ent.changes : [];
    for (const change of changes) {
      const ch = change as Record<string, unknown>;
      if (String(ch.field ?? "").trim() !== "account_update") continue;
      const value = ch.value;
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const event = String(v.event ?? "").trim();
      if (!event) continue;

      const wabaInfo = v.waba_info;
      const wabaFromInfo =
        wabaInfo && typeof wabaInfo === "object"
          ? String((wabaInfo as Record<string, unknown>).waba_id ?? "")
              .trim()
              .replace(/\s+/g, "")
          : "";
      const waba_id = wabaFromInfo;
      if (!waba_id) continue;

      return { waba_id, event, value: v };
    }
  }
  return null;
}

async function handlePartnerAddedEvent(waba_id: string): Promise<void> {
  const wabaId = String(waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!wabaId) return;

  const systemToken = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  const admin = createSupabaseAdminClient();

  const { data: business, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, onboarding_type")
    .eq("waba_id", wabaId)
    .limit(1)
    .maybeSingle();

  if (bizErr) {
    console.error("[WA Webhook] PARTNER_ADDED business lookup failed:", bizErr.message);
    return;
  }

  if (!business?.id) {
    console.warn("[WA Webhook] PARTNER_ADDED for unknown waba_id:", wabaId);
    return;
  }

  const businessId = Number((business as { id?: unknown }).id);
  const businessSlug = String((business as { slug?: unknown }).slug ?? "")
    .trim()
    .toLowerCase();
  console.info(`[WA Webhook] business found: id=${businessId}, slug=${businessSlug}`);

  const { data: channel, error: chErr } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id, provisioning_status")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (chErr) {
    console.error("[WA Webhook] PARTNER_ADDED channel lookup failed:", chErr.message);
  }

  if (channel?.phone_number_id) {
    const { error: updErr } = await admin
      .from("whatsapp_channels")
      .update({ is_active: true, provisioning_status: "active" } as any)
      .eq("business_id", businessId);
    if (updErr) {
      console.error("[WA Webhook] channel update failed:", updErr.message);
    } else {
      console.info("[WA Webhook] channel updated: provisioning_status=active");
    }
  } else if (systemToken) {
    try {
      const numbers = await fetchPhoneNumbersForWaba(wabaId, systemToken);
      console.info(
        `[WA Webhook] self-healing: fetched phone_numbers for waba_id=${wabaId} (count=${numbers.length})`
      );
      if (numbers.length === 0) {
        console.warn(
          `[WA Webhook] self-healing: no phone numbers on WABA yet waba_id=${wabaId}; skipping channel insert`
        );
      } else {
        const first = numbers[0];
        const { error: insErr } = await admin.from("whatsapp_channels").upsert(
          {
            business_id: businessId,
            business_slug: businessSlug,
            phone_number_id: first.id,
            phone_display: first.display_phone_number ?? null,
            is_active: true,
            provisioning_status: "active",
          } as any,
          { onConflict: "phone_number_id" }
        );
        if (insErr) {
          console.error("[WA Webhook] self-healing channel upsert failed:", insErr.message);
        } else {
          console.info(
            `[WA Webhook] self-healing: upserted whatsapp_channels phone_number_id=${first.id}`
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[WA Webhook] self-healing fetchPhoneNumbersForWaba failed:", msg);
    }
  } else {
    console.warn("[WA Webhook] self-healing skipped: WHATSAPP_SYSTEM_TOKEN missing");
  }

  const onboardingType = String((business as { onboarding_type?: unknown }).onboarding_type ?? "");
  if (onboardingType !== "coexistence") {
    const { data: releasedJobs, error: releaseErr } = await admin
      .from("wa_provision_jobs")
      .update({ status: "queued", updated_at: new Date().toISOString() } as any)
      .eq("business_id", businessId)
      .eq("status", "awaiting_waba")
      .select("id");
    if (releaseErr) {
      console.error("[WA Webhook] release wa_provision_jobs failed:", releaseErr.message);
    } else if (releasedJobs?.length) {
      console.info(
        `[WA Webhook] released wa_provision_jobs from awaiting_waba to queued for business_id=${businessId}`
      );
    }
  } else {
    console.info(
      `[WA Webhook] coexistence: skipping wa_provision_jobs release for business_id=${businessId}`
    );
  }

  if (systemToken) {
    try {
      await subscribeWabaToAppWebhooks(wabaId, systemToken);
      console.info("[WA Webhook] subscribed_apps: success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[WA Webhook] subscribed_apps failed:", msg);
    }
  } else {
    console.warn("[WA Webhook] subscribed_apps skipped: WHATSAPP_SYSTEM_TOKEN missing");
  }
}

// ─── GET — Meta webhook verification ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode") ?? "";
  const token = sp.get("hub.verify_token") ?? "";
  const challenge = sp.get("hub.challenge") ?? "";
  const expected = resolveMetaVerifyToken();
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Unauthorized", { status: 401 });
}

// ─── POST — incoming messages from Twilio or Meta ─────────────────────────────

export async function POST(req: NextRequest) {
  const accountSid = resolveTwilioAccountSid();
  const authToken  = resolveTwilioAuthToken();

  const rawBody = await req.text();

  // Reconstruct the public URL — req.url on Vercel is an internal address.
  // Twilio signs using the exact URL configured in its console.
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const signingUrl = `${proto}://${host}/api/whatsapp/webhook`;
  console.log("[WA Webhook] signing URL:", signingUrl, "| req.url:", req.url);

  // Meta sends JSON; Twilio sends form-urlencoded. Detect via parsed object (substring match missed some payloads).
  const rawStripped = rawBody.replace(/^\uFEFF/, "");
  const trimmedBody = rawStripped.trim();
  let metaPayload: Record<string, unknown> | null = null;
  if (trimmedBody.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmedBody);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { object?: string }).object === "whatsapp_business_account"
      ) {
        metaPayload = parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON — treat as Twilio form body below.
    }
  }

  let msg: ReturnType<typeof parseTwilioWebhook> | ReturnType<typeof parseMetaWebhook> | null = null;

  if (metaPayload) {
    const maxLog = 8192;
    const bodyForLog =
      rawStripped.length > maxLog
        ? `${rawStripped.slice(0, maxLog)}… (${rawStripped.length} bytes total)`
        : rawStripped;
    console.log("[WA Webhook] Meta raw body:", bodyForLog);

    const appSecret = resolveMetaAppSecret();
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    if (appSecret) {
      if (!verifyMetaSignature256(appSecret, sig, rawBody)) {
        console.warn("[WA Webhook] Invalid Meta signature — rejected");
        return new Response("Unauthorized", { status: 401 });
      }
    } else {
      const isProd = process.env.NODE_ENV === "production";
      console.warn(
        "[WA Webhook] WHATSAPP_APP_SECRET (or META_APP_SECRET) missing — cannot verify Meta signature"
      );
      if (isProd) {
        return new Response("Service Unavailable", { status: 503 });
      }
    }
    msg = parseMetaWebhook(metaPayload);
    if (!msg) {
      console.warn("[WA Webhook] parseMetaWebhook: no inbound message —", explainMetaWebhookSkip(metaPayload));
      const accountUpdate = parseAccountUpdate(metaPayload);
      if (accountUpdate) {
        console.info(
          `[WA Webhook] account_update: event=${accountUpdate.event}, waba_id=${accountUpdate.waba_id}`
        );
        if (accountUpdate.event === "PARTNER_ADDED") {
          await handlePartnerAddedEvent(accountUpdate.waba_id).catch((e) =>
            console.error("[WA Webhook] handlePartnerAddedEvent error:", e)
          );
        } else {
          console.info(`[WA Webhook] unhandled account_update event: ${accountUpdate.event}`);
        }
      }
    }
  } else {
    if (trimmedBody.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmedBody);
        if (parsed && typeof parsed === "object") {
          console.warn("[WA Webhook] JSON POST is not Meta WABA webhook; ignoring.", {
            object: (parsed as { object?: string }).object,
          });
          return new Response("", { status: 200 });
        }
      } catch {
        console.warn(
          "[WA Webhook] Body starts with { but JSON.parse failed; attempting Twilio form parser"
        );
      }
    }

    // Twilio: Parse form-encoded body
    const params = Object.fromEntries(new URLSearchParams(rawBody));

    // Verify Twilio signature (skip in dev if auth token not set)
    if (authToken) {
      const signature = req.headers.get("x-twilio-signature") ?? "";
      const sortedParamKeys = Object.keys(params).sort();
      const paramStr = sortedParamKeys.map(k => `${k}=${params[k]}`).join(" | ");
      const { createHmac } = await import("crypto");
      const strToSign = signingUrl + sortedParamKeys.map(k => k + (params[k] ?? "")).join("");
      const computed = createHmac("sha1", authToken).update(strToSign, "utf8").digest("base64");
      // Avoid logging signature material in production.
      if (process.env.WA_SIGNATURE_DEBUG === "1") {
        console.log("[WA Webhook] signature debug:", {
          signingUrl,
          match: computed === signature,
          paramKeys: sortedParamKeys,
        });
      }
      if (!verifyTwilioSignature(authToken, signature, signingUrl, params)) {
        console.warn("[WA Webhook] Invalid Twilio signature — rejected");
        return new Response("Unauthorized", { status: 401 });
      }
    }
    msg = parseTwilioWebhook(params);
  }

  // Process the message (awaited — webhook keeps connection open for up to 10s)
  if (msg) {
    await processIncoming(msg, accountSid, authToken).catch((e) =>
      console.error("[WA Webhook] processIncoming error:", e)
    );
  }

  // Meta expects 200 quickly as well.
  return new Response("", { status: 200 });
}

// ─── Core processing ──────────────────────────────────────────────────────────

async function processIncoming(
  msg: WaIncomingMessage,
  accountSid: string,
  authToken: string
): Promise<void> {
  // Dedup — fast in-memory path first (same instance), then durable cross-instance claim.
  if (processedMessageIds.has(msg.messageId)) {
    console.info(`[WA Webhook] Skipping duplicate ${msg.messageId}`);
    return;
  }
  processedMessageIds.add(msg.messageId);
  if (processedMessageIds.size > 10_000) {
    const first = processedMessageIds.values().next().value;
    if (first) processedMessageIds.delete(first);
  }
  const claimed = await claimMessageForProcessing(msg.messageId);
  if (!claimed) return;

  // Marketing line intercept — route to marketing flow before channel lookup
  if (msg.toNumber === "1179786855208358" && msg.type === "text") {
    console.info("[WA Webhook] Marketing line message from:", msg.from);
    try {
      const { tryHandleHeyzoeOwnerOptIn } = await import("@/lib/notifications/owner-opt-in");
      const ownerHandled = await tryHandleHeyzoeOwnerOptIn({
        senderPhone: msg.from,
        userText: msg.text,
      });
      if (ownerHandled) {
        console.info("[WA Webhook] HEYZOE_OWNER opt-in handled for:", msg.from, msg.text.slice(0, 60));
        return;
      }

      const { isHeyzoeOwnerOptInMessage } = await import("@/lib/notifications/owner-opt-in");
      if (isHeyzoeOwnerOptInMessage(msg.text)) {
        console.error(
          "[WA Webhook] HEYZOE_OWNER message was not handled by tryHandleHeyzoeOwnerOptIn — aborting flow",
          msg.text.slice(0, 80)
        );
        return;
      }

      const { logMarketingWhatsAppMessage } = await import("@/lib/marketing-whatsapp");
      const { applyMarketingInboundFollowupSideEffects, touchMarketingLeadDisplayName } =
        await import("@/lib/marketing-followups");
      const profileName =
        typeof (msg as { profileName?: string }).profileName === "string"
          ? (msg as { profileName: string }).profileName.trim()
          : "";
      await logMarketingWhatsAppMessage({ leadPhone: msg.from, role: "user", content: msg.text });

      const { handleMarketingFlowInbound, answerOpenQuestionDuringMarketingFlow, deliverMarketingPostFlowAiResponse } =
        await import("@/lib/marketing-flow-runtime");
      const flowResult = await handleMarketingFlowInbound(msg.from, msg.text, { profileName });
      await applyMarketingInboundFollowupSideEffects(msg.from, msg.text);
      if (profileName) await touchMarketingLeadDisplayName(msg.from, profileName);
      if (!flowResult.handled) {
        const { tryHandleMarketingHumanAgentInbound } = await import("@/lib/marketing-human-agent");
        if (await tryHandleMarketingHumanAgentInbound(msg.from, msg.text)) {
          console.info("[WA Webhook] Marketing human agent request for:", msg.from);
          return;
        }
      }
      if (flowResult.handled) {
        console.info("[WA Webhook] Marketing flow handled for:", msg.from);
        return;
      }
      if (flowResult.openQuestionInFlow) {
        console.info("[WA Webhook] Marketing open question in flow for:", msg.from);
        await answerOpenQuestionDuringMarketingFlow(msg.from, msg.text);
        return;
      }
      // Flow completed → AI fallback
      console.info("[WA Webhook] Marketing flow done, AI fallback for:", msg.from);
      const { recordMarketingLeadOpenQuestion } = await import("@/lib/marketing-lead-questions");
      await recordMarketingLeadOpenQuestion({ phone: msg.from, questionText: msg.text });
      await deliverMarketingPostFlowAiResponse(msg.from, msg.text);
      console.info("[WA Webhook] Marketing AI + post-flow menu sent to:", msg.from);
    } catch (e) {
      console.error("[WA Webhook] Marketing flow error:", e);
    }
    return;
  }

  const claudeApiKey = resolveClaudeApiKey();
  if (!claudeApiKey) {
    console.error("[WA Webhook] Missing ANTHROPIC_API_KEY");
    return;
  }

  const supabase = createSupabaseAdminClient();

  // Route: look up business by Twilio/Meta "To" number (גם ערוץ כבוי — לתגובת מנוי לא פעיל)
  const { data: channel } = await supabase
    .from("whatsapp_channels")
    .select("business_slug, business_id, phone_number_id, is_active")
    .eq("phone_number_id", msg.toNumber)
    .maybeSingle();

  if (!channel) {
    console.warn(`[WA Webhook] No channel for number: ${msg.toNumber}`);
    return;
  }

  const { business_slug } = channel;
  const channelActive = (channel as { is_active?: boolean }).is_active === true;

  const nowIso = new Date().toISOString();

  // Resolve business_id + subscription gate (needed for contacts upsert)
  let businessId: string | null = (channel as any).business_id ?? null;
  try {
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .select("id, is_active, social_links, cancellation_effective_at")
      .eq("slug", business_slug)
      .maybeSingle();
    if (bizErr || !biz) {
      console.warn(`[WA Webhook] Business lookup failed — skip auto-reply: ${business_slug}`, bizErr?.message);
      return;
    }
    if (!businessId) {
      const resolvedId = (biz as { id?: string | number | null }).id;
      businessId = resolvedId != null ? String(resolvedId) : null;
    }
    const { isBusinessServiceActive } = await import("@/lib/complimentary-dashboard-access");
    if (!isBusinessServiceActive(business_slug, biz as { is_active?: boolean; cancellation_effective_at?: string | null })) {
      const inactiveReply = buildInactiveBusinessAutoReply(
        customerServicePhoneFromSocialLinks((biz as { social_links?: unknown }).social_links)
      );
      const phoneNumberId = String((channel as { phone_number_id?: string }).phone_number_id ?? msg.toNumber).trim();
      const sessionId = buildWaSessionId(phoneNumberId, msg.from);
      try {
        await sendWhatsAppMessage(msg.toNumber, msg.from, inactiveReply, accountSid, authToken);
        await logMessage({
          business_slug,
          role: "assistant",
          content: inactiveReply,
          model_used: BUSINESS_INACTIVE_AUTO_REPLY_MODEL,
          session_id: sessionId,
        });
        console.info(`[WA Webhook] Business inactive — sent auto-reply: ${business_slug}`);
      } catch (e) {
        console.error(`[WA Webhook] Business inactive auto-reply failed: ${business_slug}`, e);
      }
      return;
    }
    if (!channelActive) {
      console.warn(`[WA Webhook] Channel inactive for active business — skip: ${business_slug}`);
      return;
    }
  } catch (e) {
    console.warn("[WA Webhook] failed to resolve business / is_active — skip auto-reply:", e);
    return;
  }

  type BizQuotaSnapshot = {
    id?: unknown;
    plan?: unknown;
    email?: unknown;
    name?: unknown;
    slug?: unknown;
    social_links?: unknown;
    owner_whatsapp_phone?: unknown;
    owner_whatsapp_opted_in?: unknown;
    is_active?: unknown;
    cancellation_effective_at?: unknown;
    quota_warning_20_sent_at?: unknown;
    quota_warning_5_sent_at?: unknown;
    quota_limit_sent_at?: unknown;
    quota_pro_warning_sent_at?: unknown;
  };
  let bizQuotaRow: BizQuotaSnapshot | null = null;
  try {
    const { data: bqr } = await supabase
      .from("businesses")
      .select(
        "id, plan, email, name, slug, social_links, owner_whatsapp_phone, owner_whatsapp_opted_in, is_active, cancellation_effective_at, quota_warning_20_sent_at, quota_warning_5_sent_at, quota_limit_sent_at, quota_pro_warning_sent_at"
      )
      .eq("slug", business_slug)
      .maybeSingle();
    bizQuotaRow = (bqr ?? null) as BizQuotaSnapshot | null;
  } catch (e) {
    console.warn("[WA Webhook] businesses quota/plan fetch failed:", e);
  }
  const starterBlocksMedia = planIsStarter(bizQuotaRow?.plan);

  // ── SAVE CONTACT (upsert) + OPT-IN/OPT-OUT gating ───────────────────────────
  // Always try to save/update the contact on any inbound message.
  // If contact is opted out, we may early-return before reaching any automated flow.
  let contactOptedOut: boolean | null = null;
  let contactNotRelevantAt: string | null = null;
  let contactHumanRequestedAt: string | null = null;
  let contactClaudeCount: number | null = null;
  let contactTrialRegistered: boolean | null = null;
  let contactTrialRegisteredAt: string | null = null;
  // Persisted registration blocks trial CTA even if the flow is reset later.
  let allowTrialCtaThisSession = false;
  let contactSessionPhase: HeyzoeSessionPhase = "opening";
  let contactFlowStep = 0;
  let contactScheduleRequestedDate = "";
  let contactScheduleRequestedTime = "";
  let contactId: string | number | null = null;
  let starterQuotaNoticeMonth: string | null = null;
  /** אל תחזירו הנעה לאינסטגרם לאחר שנשלחה כבר הזמנה לעקוב */
  let contactInstagramFollowPromptSent = false;
  /** סוגי CTA שכבר צורכו (מערכת שעות / מנויים / כתובת) למעט ניסיון — מתאפס בברכה */
  let sfClickedCtaKinds: string[] = [];
  let isFirstTimeContact = false;
  if (businessId) {
    try {
      // אותו פורמט כמו /api/leads/incoming (972...) — msg.from מ-Meta הוא +972...
      const contactPhone =
        normalizePhone(msg.from) ?? (waSessionPhoneKey(msg.from) || String(msg.from ?? "").trim());
      const phoneLookupVariants = contactPhoneLookupVariants(msg.from);
      const fullName =
        typeof (msg as any).profileName === "string" ? (msg as any).profileName.trim() : "";

      console.info("[new_lead_notification] checking new lead notification", {
        businessId,
        business_slug,
        phone: contactPhone,
      });
      let priorContact: {
        id?: string | number;
        wa_followup_stage?: number | null;
        last_contact_at?: string | null;
        wa_no_response_at?: string | null;
      } | null = null;
      try {
        const priorQ = await supabase
          .from("contacts")
          .select("id, wa_followup_stage, last_contact_at, wa_no_response_at")
          .eq("business_id", businessId)
          .in("phone", phoneLookupVariants.length ? phoneLookupVariants : [contactPhone])
          .maybeSingle();
        if (!priorQ.error) priorContact = priorQ.data;
        else if (/wa_no_response_at|column/i.test(String(priorQ.error.message ?? ""))) {
          const fallback = await supabase
            .from("contacts")
            .select("id, wa_followup_stage, last_contact_at")
            .eq("business_id", businessId)
            .in("phone", phoneLookupVariants.length ? phoneLookupVariants : [contactPhone])
            .maybeSingle();
          if (!fallback.error) priorContact = fallback.data;
        } else {
          const fallback = await supabase
            .from("contacts")
            .select("id")
            .eq("business_id", businessId)
            .in("phone", phoneLookupVariants.length ? phoneLookupVariants : [contactPhone])
            .maybeSingle();
          if (!fallback.error) priorContact = fallback.data;
        }
        isFirstTimeContact = !priorContact?.id;
      } catch {
        isFirstTimeContact = false;
      }
      console.info("[new_lead_notification] isFirstTimeContact result", {
        businessId,
        business_slug,
        phone: contactPhone,
        isFirstTimeContact,
      });

      const upsertPayload: Record<string, unknown> = {
        phone: contactPhone,
        business_id: businessId,
        source: "whatsapp",
        last_contact_at: nowIso,
        followup_sent: false,
      };
      if (fullName) upsertPayload.full_name = fullName;

      const priorNoResponseAt = String(priorContact?.wa_no_response_at ?? "").trim();
      if (priorNoResponseAt) {
        Object.assign(upsertPayload, buildNoResponseReactivationPatch());
        console.info("[WA Webhook] no-response lead reactivated on inbound message", {
          business_slug,
          phone: contactPhone,
          prior_wa_no_response_at: priorNoResponseAt,
        });
        void logMessage({
          business_slug,
          role: "event",
          content: "[heyzoe:no_response:reactivated]",
          model_used: "no_response_reactivated",
          session_id: buildWaSessionId(msg.toNumber, msg.from),
        }).catch((e) => console.error("[WA Webhook] no-response reactivation log failed:", e));
      }

      if (shouldResetWaFollowupCycleOnInbound(priorContact)) {
        Object.assign(upsertPayload, WA_FOLLOWUP_CYCLE_RESET_PATCH);
        console.info("[WA Webhook] wa_followup cycle reset (48h+ since last_contact_at)", {
          business_slug,
          phone: contactPhone,
          prior_stage: priorContact?.wa_followup_stage ?? 0,
          prior_last_contact_at: priorContact?.last_contact_at ?? null,
        });
      }

      let contactRow: any = null;
      let upsertErr: any = null;
      try {
        const writeResult = priorContact?.id
          ? await supabase.from("contacts").update(upsertPayload).eq("id", priorContact.id)
          : await supabase
              .from("contacts")
              .upsert(upsertPayload, { onConflict: "business_id,phone" });
        upsertErr = writeResult.error;
        if (upsertErr) {
          console.warn("[WA Webhook] contacts upsert failed (continuing):", upsertErr);
        } else {
          const selectVariants = [
            "opted_out, not_relevant_at, human_requested_at, claude_message_count, trial_registered, trial_registered_at, session_phase, flow_step, warmup_extra_awaiting_idx, sf_requested_date, sf_requested_time, id, starter_quota_notice_month, sf_clicked_cta_kinds, instagram_follow_prompt_sent",
            "opted_out, claude_message_count, trial_registered, trial_registered_at, session_phase, flow_step, warmup_extra_awaiting_idx, sf_requested_date, sf_requested_time, id, sf_clicked_cta_kinds, instagram_follow_prompt_sent",
            "opted_out, claude_message_count, trial_registered, trial_registered_at, session_phase, flow_step, warmup_extra_awaiting_idx, id, starter_quota_notice_month",
            "opted_out, claude_message_count, trial_registered, trial_registered_at, session_phase, flow_step, warmup_extra_awaiting_idx, id",
            "opted_out, claude_message_count, trial_registered, trial_registered_at, id, starter_quota_notice_month",
            "opted_out, claude_message_count, trial_registered, trial_registered_at, id",
            "opted_out, claude_message_count, trial_registered, session_phase, flow_step, warmup_extra_awaiting_idx, id",
            "opted_out, claude_message_count, trial_registered, id",
            "opted_out",
          ];
          for (const cols of selectVariants) {
            const q = await supabase
              .from("contacts")
              .select(cols)
              .eq("business_id", businessId)
              .in("phone", phoneLookupVariants.length ? phoneLookupVariants : [contactPhone])
              .maybeSingle();
            if (!q.error) {
              contactRow = q.data;
              break;
            }
          }
          if (!contactRow) console.warn("[WA Webhook] contacts select-after-upsert failed for all column variants");
        }
      } catch (e) {
        console.warn("[WA Webhook] contacts upsert/select threw:", e);
      }

      contactOptedOut =
        typeof (contactRow as any)?.opted_out === "boolean" ? (contactRow as any).opted_out : null;
      contactNotRelevantAt =
        typeof (contactRow as any)?.not_relevant_at === "string"
          ? String((contactRow as any).not_relevant_at).trim() || null
          : null;
      contactHumanRequestedAt =
        typeof (contactRow as any)?.human_requested_at === "string"
          ? String((contactRow as any).human_requested_at).trim() || null
          : null;
      const cc = (contactRow as any)?.claude_message_count;
      contactClaudeCount = typeof cc === "number" && Number.isFinite(cc) ? cc : null;
      contactTrialRegistered =
        typeof (contactRow as any)?.trial_registered === "boolean"
          ? (contactRow as any).trial_registered
          : null;
      contactTrialRegisteredAt =
        typeof (contactRow as any)?.trial_registered_at === "string" ? (contactRow as any).trial_registered_at : null;

      contactSessionPhase = normalizeSessionPhase((contactRow as any)?.session_phase);
      // CTA ניסיון חוזר מותר אחרי «היי» (phase ≠ registered) גם אם trial_registered=true.
      allowTrialCtaThisSession =
        contactTrialRegistered !== true || contactSessionPhase !== "registered";

      const fs = (contactRow as any)?.flow_step;
      contactFlowStep = typeof fs === "number" && Number.isFinite(fs) ? fs : 0;
      contactScheduleRequestedDate = String((contactRow as any)?.sf_requested_date ?? "").trim();
      contactScheduleRequestedTime = String((contactRow as any)?.sf_requested_time ?? "").trim();

      const cid = (contactRow as any)?.id;
      contactId = cid !== undefined && cid !== null ? cid : null;
      const sqm = (contactRow as any)?.starter_quota_notice_month;
      starterQuotaNoticeMonth = typeof sqm === "string" && sqm.trim() ? sqm.trim() : null;

      const rawKinds = (contactRow as any)?.sf_clicked_cta_kinds;
      if (Array.isArray(rawKinds)) {
        sfClickedCtaKinds = rawKinds.map((x) => String(x ?? "").trim()).filter(Boolean);
      }
      contactInstagramFollowPromptSent = (contactRow as any)?.instagram_follow_prompt_sent === true;
    } catch (e) {
      console.warn("[WA Webhook] contacts upsert threw (continuing):", e);
    }
  } else {
    console.warn("[WA Webhook] missing business_id; skipping contacts upsert");
  }

  // Helper: normalize inbound text for matching
  const incomingTextRaw = msg.type === "text" ? msg.text : "";
  const incomingText = incomingTextRaw.trim().toLowerCase();

  const matchesAny = (hay: string, needles: string[]) => {
    const h = hay.trim().toLowerCase();
    if (!h) return false;
    return needles.some((n) => h === n || h.includes(n));
  };

  const OPT_OUT = [
    "הסר",
    "הסרה",
    "הפסק",
    "בטל",
    "לא רוצה",
    "עצור",
    "stop",
    "unsubscribe",
    "remove",
    "cancel",
    "opt out",
    "optout",
  ];
  const OPT_IN = [
    "הצטרף",
    "כן",
    "חזור",
    "רוצה לקבל",
    "start",
    "join",
    "subscribe",
    "yes",
  ];

  let optedInThisMessage = false;
  const earlySessionId = buildWaSessionId(msg.toNumber, msg.from);

  // 1.5) NOT RELEVANT — עצירת פלואו ופולואפים (נפרד מ-הסר)
  if (msg.type === "text" && businessId && !contactNotRelevantAt && matchesNotRelevantKeyword(incomingTextRaw)) {
    const fullName =
      typeof (msg as { profileName?: string }).profileName === "string"
        ? (msg as { profileName?: string }).profileName!.trim()
        : "";
    await handleLeadNotRelevant({
      supabase,
      businessId: Number(businessId),
      businessSlug: business_slug,
      phone: msg.from,
      text: incomingTextRaw,
      nowIso,
      waFromNumber: msg.toNumber,
      accountSid,
      authToken,
      sessionId: earlySessionId,
      fullName: fullName || null,
    });
    return;
  }

  // 1.6) NOT RELEVANT (Claude) — רחוק / לא מתאים / לא מעוניין (לא opt-out)
  if (
    msg.type === "text" &&
    businessId &&
    !contactNotRelevantAt &&
    incomingText.length >= 4 &&
    incomingText.length <= 400 &&
    !matchesNotRelevantKeyword(incomingTextRaw)
  ) {
    const apiKey = resolveClaudeApiKey();
    if (apiKey) {
      const isNotRelevant = await classifyNotRelevantIntentWithClaude({
        apiKey,
        text: incomingTextRaw,
      });
      if (isNotRelevant) {
        const fullName =
          typeof (msg as { profileName?: string }).profileName === "string"
            ? (msg as { profileName?: string }).profileName!.trim()
            : "";
        await handleLeadNotRelevant({
          supabase,
          businessId: Number(businessId),
          businessSlug: business_slug,
          phone: msg.from,
          text: incomingTextRaw,
          nowIso,
          waFromNumber: msg.toNumber,
          accountSid,
          authToken,
          sessionId: earlySessionId,
          fullName: fullName || null,
        });
        return;
      }
    }
  }

  // 2) OPT-OUT DETECTION (only for text)
  if (msg.type === "text" && matchesAny(incomingText, OPT_OUT)) {
    if (businessId) {
      await supabase
        .from("contacts")
        .update({ opted_out: true, opted_out_at: nowIso })
        .eq("business_id", businessId)
        .eq("phone", msg.from);
    }
    await sendWhatsAppMessage(
      msg.toNumber,
      msg.from,
      "הוסרת בהצלחה מרשימת ההתראות ✅\nאם תרצה לחזור בעתיד, פשוט שלח *הצטרף*",
      accountSid,
      authToken
    ).catch((e) => console.error("[WA Webhook] Send opt-out reply failed:", e));
    return;
  }

  // 2.1) OPT-OUT DETECTION (Claude) — before any other automation
  // Skip for explicit opt-in, menu numeric, and short "trial registered" confirmations (handled elsewhere).
  if (
    msg.type === "text" &&
    !optedInThisMessage &&
    businessId &&
    incomingText.length >= 3 &&
    incomingText.length <= 300 &&
    !matchesTrialRegisteredMessage(incomingTextRaw)
  ) {
    const apiKey = resolveClaudeApiKey();
    if (apiKey) {
      const wantsOptOut = await classifyOptOutWithClaude({ apiKey, text: incomingTextRaw });
      if (wantsOptOut) {
        await supabase
          .from("contacts")
          .update({ opted_out: true, opted_out_at: nowIso })
          .eq("business_id", businessId)
          .eq("phone", msg.from);
        await sendWhatsAppMessage(
          msg.toNumber,
          msg.from,
          "הוסרת בהצלחה מרשימת ההתראות ✅\nאם תרצה לחזור בעתיד, פשוט שלח *הצטרף*",
          accountSid,
          authToken
        ).catch((e) => console.error("[WA Webhook] Send opt-out reply failed:", e));
        return;
      }
    }
  }

  // 3) OPT-IN DETECTION (for users who previously opted out)
  if (msg.type === "text" && contactOptedOut === true && matchesAny(incomingText, OPT_IN)) {
    if (businessId) {
      await supabase
        .from("contacts")
        .update({ opted_out: false, opted_in_at: nowIso, opted_out_at: null })
        .eq("business_id", businessId)
        .eq("phone", msg.from);
    }
    await sendWhatsAppMessage(
      msg.toNumber,
      msg.from,
      "ברוך שובך! 🎉 נשמח לעדכן אותך שוב בהמשך",
      accountSid,
      authToken
    ).catch((e) => console.error("[WA Webhook] Send opt-in reply failed:", e));
    // Continue to Zoe normally (don't early-return)
    contactOptedOut = false;
    optedInThisMessage = true;
  }

  // 1) If currently opted out, do not pass to Zoe (or any automated flow)
  if (contactOptedOut === true) {
    await sendWhatsAppMessage(
      msg.toNumber,
      msg.from,
      "שלום! כרגע הסרת את עצמך מרשימת ההתראות שלנו. אם תרצה לחזור שלח *הצטרף* או *כן*",
      accountSid,
      authToken
    ).catch((e) => console.error("[WA Webhook] Send opted-out gating reply failed:", e));
    return;
  }

  if (contactNotRelevantAt) {
    // ליד «לא רלוונטי» ששלח מילת פתיחת פלואו («אשמח לפרטים» וכו׳) או הביע כוונה
    // להתחיל פלואו מחדש — מפעילים אותו מחדש (סטטוס חוזר לפעיל) וממשיכים לפלואו הרגיל.
    let wantsFlowRestart = isSalesFlowStartInbound(msg);
    if (
      !wantsFlowRestart &&
      msg.type === "text" &&
      businessId &&
      incomingText.length >= 3 &&
      incomingText.length <= 300
    ) {
      const apiKey = resolveClaudeApiKey();
      if (apiKey) {
        wantsFlowRestart = await classifySalesFlowStartIntentWithClaude({
          apiKey,
          text: incomingTextRaw,
        });
      }
    }

    if (wantsFlowRestart && businessId) {
      const reactivated = await reactivateNotRelevantLead({
        supabase,
        businessId: Number(businessId),
        businessSlug: business_slug,
        phone: msg.from,
        sessionId: earlySessionId,
        contactId,
      });
      if (reactivated) {
        console.info("[WA Webhook] not-relevant lead reactivated via flow-start trigger", {
          business_slug,
          session_id: earlySessionId,
        });
        contactNotRelevantAt = null;
        // ממשיכים — הברכה/כוונת הפתיחה יזוהו בהמשך ויאתחלו את פלואו המכירה.
      }
    }

    // רשת ביטחון: המשך פלואו בלחיצת כפתור — אם not_relevant_at נשאר ב-DB (פורמט טלפון וכו׳).
    if (
      contactNotRelevantAt &&
      !wantsFlowRestart &&
      msg.type === "text" &&
      isMetaInteractiveMenuReply(msg) &&
      businessId &&
      (contactSessionPhase === "opening" ||
        contactSessionPhase === "warmup" ||
        contactSessionPhase === "schedule_date" ||
        contactSessionPhase === "schedule_time" ||
        contactSessionPhase === "cta")
    ) {
      const reactivated = await reactivateNotRelevantLead({
        supabase,
        businessId: Number(businessId),
        businessSlug: business_slug,
        phone: msg.from,
        sessionId: earlySessionId,
        contactId,
      });
      if (reactivated) {
        console.info("[WA Webhook] not-relevant lead reactivated via in-flow menu pick", {
          business_slug,
          session_id: earlySessionId,
          session_phase: contactSessionPhase,
        });
        contactNotRelevantAt = null;
      }
    }

    if (contactNotRelevantAt) {
      await sendWhatsAppMessage(
        msg.toNumber,
        msg.from,
        NOT_RELEVANT_REPLY_MESSAGE,
        accountSid,
        authToken
      ).catch((e) => console.error("[WA Webhook] Send not-relevant gating reply failed:", e));
      return;
    }
  }

  const sessionId = earlySessionId || buildWaSessionId(msg.toNumber, msg.from);

  if (businessId) {
    try {
      const { ensureConversation } = await import("@/lib/notifications/conversations");
      const conv = await ensureConversation({
        businessId: Number(businessId),
        phone: msg.from,
        sessionId,
      });
      if (isFirstTimeContact) {
        const bizName =
          String((bizQuotaRow as { name?: string } | null)?.name ?? "").trim() ||
          String(business_slug ?? "").trim();
        const { triggerNewLeadNotification } = await import("@/lib/notifications/triggers");
        void triggerNewLeadNotification({
          businessId: Number(businessId),
          businessName: bizName || "העסק שלך",
          leadPhone: msg.from,
        }).catch((e) =>
          console.error("[new_lead_notification] trigger threw:", e)
        );
      }
      void conv;
    } catch (e) {
      console.warn("[WA Webhook] owner notifications setup failed:", e);
    }
  }

  if (msg.type === "text" && businessId) {
    try {
      if (userRequestedHumanAgent(msg.text)) {
        const { handleLeadHumanRequested } = await import("@/lib/human-requested");
        await handleLeadHumanRequested({
          supabase,
          businessId: Number(businessId),
          businessSlug: business_slug,
          phone: msg.from,
          nowIso,
          sessionId,
        });
      }
    } catch (e) {
      console.warn("[WA Webhook] human_requested handling failed:", e);
    }
  }

  // Detect "new lead" (first inbound user message in this session).
  // Important: the business may have sent outbound messages (assistant/event logs) before a user ever replies.
  let isNewLead = false;
  try {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true } as any)
      .eq("business_slug", business_slug)
      .eq("session_id", sessionId)
      .eq("role", "user");
    isNewLead = (count ?? 0) === 0;
  } catch (e) {
    console.warn("[WA Webhook] new-lead check failed (continuing):", e);
  }

  const knowledge = await getBusinessKnowledgePack(business_slug);
  const salesFlowServices = knowledge?.salesFlowServices ?? [];

  // Handle unsupported message types
  if (msg.type === "unsupported") {
    let sendFailed = false;
    try {
      await sendWhatsAppMessage(
        msg.toNumber,
        msg.from,
        WA_UNSUPPORTED_INBOUND_REPLY,
        accountSid,
        authToken
      );
    } catch (e) {
      sendFailed = true;
      console.error("[WA Webhook] Send unsupported reply failed:", e);
    }

    try {
      await logMessage({
        business_slug,
        role: "assistant",
        content: WA_UNSUPPORTED_INBOUND_REPLY,
        model_used: WA_UNSUPPORTED_INBOUND_MODEL,
        session_id: sessionId,
        error_code: sendFailed ? "unsupported_reply_send_failed" : null,
      });
    } catch (e) {
      console.error("[WA Webhook] Log unsupported reply failed:", e);
    }

    console.warn("[WA Webhook] unsupported inbound message type", {
      business_slug,
      sessionId,
      from: msg.from,
      metaInboundType: msg.metaInboundType ?? null,
      sendFailed,
    });
    return;
  }

  // Log user message
  await logMessage({
    business_slug,
    role: "user",
    content: msg.text,
    session_id: sessionId,
  });

  let contactProcessingClaimedUntil: string | null = null;
  if (contactId != null) {
    const lock = await acquireContactProcessingLock(contactId);
    if (!lock.acquired) {
      console.info(
        `[WA Webhook] Contact ${contactId} already processing — message logged, skipping duplicate handler`,
        { business_slug, sessionId, messageId: msg.messageId }
      );
      return;
    }
    contactProcessingClaimedUntil = lock.claimedUntil;
  } else {
    console.error("[WA Webhook] missing contactId — proceeding without contact processing lock (fail-open)", {
      business_slug,
      sessionId,
      messageId: msg.messageId,
    });
  }

  try {
  // Check if this session is currently paused (manual takeover by human).
  try {
    const nowIso = new Date().toISOString();
    const { data: paused } = await supabase
      .from("paused_sessions")
      .select("id, paused_until")
      .eq("business_slug", business_slug)
      .eq("session_id", sessionId)
      .gt("paused_until", nowIso)
      .maybeSingle();
    if (paused) {
      console.info(
        `[WA Webhook] Session ${sessionId} for ${business_slug} is paused until ${paused.paused_until}; skipping auto-reply.`
      );
      return;
    }
  } catch (e) {
    console.error("[WA Webhook] pause-check failed (continuing anyway):", e);
  }

  if (businessId && bizQuotaRow) {
    try {
      const quotaResult = await handleMonthlyConversationQuota({
        admin: supabase,
        businessSlug: business_slug,
        businessId,
        bizRow: bizQuotaRow,
        contactId,
        starterQuotaNoticeMonth,
        phone: msg.from,
      });
      if (quotaResult.action === "silent_stop") {
        return;
      }
      if (quotaResult.action === "starter_cap_message") {
        try {
          await sendWhatsAppMessage(msg.toNumber, msg.from, quotaResult.message, accountSid, authToken);
        } catch (e) {
          console.error("[WA Webhook] starter quota cap reply failed:", e);
          return;
        }
        await logMessage({
          business_slug,
          role: "assistant",
          content: quotaResult.message,
          model_used: "starter_quota_cap_notice",
          session_id: sessionId,
        });
        const up = await supabase
          .from("contacts")
          .update({ starter_quota_notice_month: quotaResult.markMonth })
          .eq("business_id", businessId)
          .eq("phone", msg.from);
        if (up.error) console.warn("[WA Webhook] starter_quota_notice_month update:", up.error.message);
        return;
      }
    } catch (e) {
      console.error("[WA Webhook] monthly quota handler failed:", e);
    }
  }

  // בקשת נציג — הודעת «אין בעיה» פעם אחת, אחר כך שקט (ללא פלואו / AI / resend)
  if (contactHumanRequestedAt) {
    console.info("[WA Webhook] human_requested — skipping auto-reply", {
      business_slug,
      sessionId,
      human_requested_at: contactHumanRequestedAt,
    });
    return;
  }
  if (msg.type === "text" && businessId && userRequestedHumanAgent(msg.text.trim())) {
    if (knowledge?.salesFlowConfig) {
      await trySendSalesFlowHumanAgentHandoff({
        inboundText: msg.text.trim(),
        knowledge,
        msg,
        accountSid,
        authToken,
        business_slug,
        sessionId,
      });
    }
    return;
  }

  // Trial registration keyword → update contact + send after-trial template (no Claude)
  if (msg.type === "text" && businessId && knowledge) {
    const rawTrimmed = msg.text.trim();
    if (matchesTrialRegisteredMessage(rawTrimmed)) {
      try {
        const alreadyRegisteredClaim = matchesTrialAlreadyRegisteredMessage(rawTrimmed);
        let repeatRegistrationInSameSession = false;
        const sel = await supabase
          .from("contacts")
          .select("trial_registered, trial_registered_at, session_phase")
          .eq("business_id", businessId)
          .in("phone", contactPhoneLookupVariants(msg.from))
          .maybeSingle();
        if (sel.error) {
          console.warn("[WA Webhook] trial_registered select:", sel.error.message);
        } else {
          const row = sel.data as {
            trial_registered?: boolean;
            trial_registered_at?: string | null;
            session_phase?: string | null;
          } | null;
          repeatRegistrationInSameSession = shouldAckRepeatTrialRegistration({
            trialRegistered: row?.trial_registered === true,
            trialRegisteredAt:
              typeof row?.trial_registered_at === "string" ? row.trial_registered_at : null,
            sessionPhase: normalizeSessionPhase(row?.session_phase),
          });
        }

        if (repeatRegistrationInSameSession) {
          const repeatTxt =
            "כבר שלחנו את הוראות ההמשך. אם משהו חסר - כתבו כאן ונעזור 😊";
          await sendWhatsAppMessage(msg.toNumber, msg.from, repeatTxt, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send trial-registered repeat reply failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: repeatTxt,
            model_used: "trial_registered_repeat_ack",
            session_id: sessionId,
          });
          return;
        }

        if (alreadyRegisteredClaim) {
          const { error: upErr } = await supabase
            .from("contacts")
            .update(buildTrialRegisteredContactPatch(contactTrialRegisteredAt || nowIso))
            .eq("business_id", businessId)
            .in("phone", contactPhoneLookupVariants(msg.from));
          if (upErr) {
            console.warn("[WA Webhook] trial_registered already-claim update failed:", upErr.message);
          } else {
            await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: "registered" });
            contactTrialRegistered = true;
            allowTrialCtaThisSession = false;
            contactSessionPhase = "registered";
            contactFlowStep = 0;
            await logMessage({
              business_slug,
              role: "event",
              content: HEYZOE_SF_REGISTERED,
              model_used: "sf_registered_already_claim",
              session_id: sessionId,
            });
          }

          const ackTxt =
            "מעולה, תודה שעדכנת אותי. לא אשלח עוד הודעות הרשמה לשיעור ניסיון. אם יש עוד משהו שתרצו לדעת - כתבו לי כאן ואשמח לעזור 🙂";
          await sendWhatsAppMessage(msg.toNumber, msg.from, ackTxt, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send trial already-registered ack failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: ackTxt,
            model_used: "trial_registered_already_ack",
            session_id: sessionId,
          });
          return;
        }

        const useScheduleRegistrationTemplate = knowledge.scheduleDirectRegistration === false;
        const sfCfg = knowledge.salesFlowConfig ?? defaultSalesFlowConfig(knowledge.vibeLabels ?? []);
        const scheduleState = await fetchContactScheduleSelectionState({
          supabase,
          businessId,
          phone: msg.from,
        });
        const requestedDate = scheduleState.requestedDate || contactScheduleRequestedDate;
        const requestedTime = scheduleState.requestedTime || contactScheduleRequestedTime;
        const hasScheduleSelection = Boolean(requestedDate && requestedTime);

        const selectedServiceName =
          salesFlowServices.length === 1
            ? salesFlowServices[0]!.name
            : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
        const selectedService =
          salesFlowServices.find((service) => service.name === selectedServiceName) ??
          salesFlowServices[0] ??
          null;
        const regOfferKind = selectedService?.offerKind ?? "trial";
        const regServiceFallback =
          regOfferKind === "workshop" ? "הסדנה" : regOfferKind === "course" ? "הקורס" : "האימון";
        const serviceName =
          selectedService?.name?.trim() || selectedServiceName.trim() || regServiceFallback;

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

        const hasCourseCycleDate =
          regOfferKind === "course" && Boolean(String(requestedDate ?? "").trim());
        const hasWorkshopSchedulePick =
          regOfferKind === "workshop" &&
          (Boolean(String(requestedDate ?? "").trim()) || Boolean(String(requestedTime ?? "").trim()));
        const templateWantsScheduleFields =
          bodyTemplate.includes("{requested_date}") ||
          bodyTemplate.includes("{requested_time}") ||
          bodyTemplate.includes("{course_schedule}");
        if (
          hasCourseCycleDate ||
          hasWorkshopSchedulePick ||
          (!useScheduleRegistrationTemplate &&
            hasScheduleSelection &&
            templateWantsScheduleFields)
        ) {
          const scheduleBody = resolveAfterRegistrationBodyTemplate(sfCfg, regOfferKind, true).trim();
          if (scheduleBody) bodyTemplate = scheduleBody;
        }

        const igUrlRaw = knowledge.instagramUrl?.trim() ?? "";
        const includeIgPrompt = igUrlRaw.length > 0 && !contactInstagramFollowPromptSent;
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
        const courseSchedForReg =
          regOfferKind === "course" && requestedDate
            ? courseSchedulePhraseForRegistration(selectedService, requestedDate)
            : "";
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
                courseSchedulePhrase: courseSchedForReg,
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

        const { error: upErr } = await supabase
          .from("contacts")
          .update(buildTrialRegisteredContactPatch(nowIso))
          .eq("business_id", businessId)
          .in("phone", contactPhoneLookupVariants(msg.from));
        if (upErr) {
          console.warn("[WA Webhook] trial_registered update failed:", upErr.message);
        } else {
          await updateContactSessionPhase({ supabase, businessId, phone: msg.from, phase: "registered" });
          contactSessionPhase = "registered";
          contactFlowStep = 0;
          await logMessage({
            business_slug,
            role: "event",
            content: HEYZOE_SF_REGISTERED,
            model_used: "sf_registered",
            session_id: sessionId,
          });
          try {
            let warmupSummaryPrecomputed: string | undefined;
            try {
              const { buildWarmupSummaryFromSession } = await import(
                "@/lib/notifications/warmup-summary"
              );
              const built = await buildWarmupSummaryFromSession({
                businessSlug: business_slug,
                sessionId,
              });
              const trimmed = String(built ?? "").trim();
              if (trimmed) warmupSummaryPrecomputed = trimmed;
            } catch (warmupErr) {
              console.warn("[WA Webhook] warmup summary precompute failed:", warmupErr);
            }
            const { triggerLeadRegisteredNotification } = await import("@/lib/notifications/triggers");
            void triggerLeadRegisteredNotification({
              businessId: Number(businessId),
              leadPhone: msg.from,
              businessSlug: business_slug,
              sessionId,
              registeredAtIso: nowIso,
              scheduleDirectRegistration: knowledge.scheduleDirectRegistration !== false,
              requestedDate,
              requestedTime,
              warmupSummaryPrecomputed,
            });
            const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
            void dispatchCrmEvent({
              businessId: Number(businessId),
              leadPhone: msg.from,
              kind: "trial_registered",
              eventAtIso: nowIso,
              registration: {
                serviceName,
                offerKind: regOfferKind,
                requestedDate,
                requestedTime,
                courseSchedulePhrase: courseSchedForReg || null,
              },
            });
          } catch (e) {
            console.warn("[WA Webhook] lead_registered notification failed:", e);
          }
        }

        const directionsMediaUrl = knowledge.directionsMediaUrl?.trim() ?? "";
        const directionsCaption = [
          knowledge.addressText?.trim() ? `הכתובת שלנו:\n${knowledge.addressText.trim()}` : "",
          knowledge.directionsText?.trim() ? `ככה מגיעים אלינו:\n${knowledge.directionsText.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        if (directionsMediaUrl && !starterBlocksMedia) {
          await sendWhatsAppMediaMessage(
            msg.toNumber,
            msg.from,
            directionsMediaUrl,
            accountSid,
            authToken,
            directionsCaption || undefined,
            knowledge.directionsMediaType === "video"
              ? "video"
              : knowledge.directionsMediaType === "image"
                ? "image"
                : undefined
          ).catch((e) => console.error("[WA Webhook] Send directions media after registration failed:", e));
          await logMessage({
            business_slug,
            role: "assistant",
            content: `[media] ${directionsMediaUrl}${directionsCaption ? `\n\n${directionsCaption}` : ""}`,
            model_used: "directions_media",
            session_id: sessionId,
          });
        }

        await sendWhatsAppMessage(msg.toNumber, msg.from, outText, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send after-trial registration body failed:", e)
        );
        await logMessage({
          business_slug,
          role: "assistant",
          content: outText,
          model_used: "sales_flow_after_trial_registered",
          session_id: sessionId,
        });
        if (businessId && includeIgPrompt) {
          const igUp = await supabase
            .from("contacts")
            .update({ instagram_follow_prompt_sent: true })
            .eq("business_id", businessId)
            .eq("phone", msg.from);
          if (igUp.error) console.warn("[WA Webhook] instagram_follow_prompt_sent update:", igUp.error.message);
          else contactInstagramFollowPromptSent = true;
        }
        return;
      } catch (e) {
        console.warn("[WA Webhook] trial_registered flow failed (continuing to normal handling):", e);
      }
    }
  }

  const sendOpeningMediaIfConfigured = async (): Promise<boolean> => {
    if (starterBlocksMedia) return false;
    const mediaUrl = knowledge?.openingMediaUrl?.trim() ?? "";
    if (!mediaUrl) return false;
    const mediaKind =
      knowledge?.openingMediaType === "video"
        ? "video"
        : knowledge?.openingMediaType === "image"
          ? "image"
          : undefined;
    const attempt = async (kindOverride?: "image" | "video") => {
      await sendWhatsAppMediaMessage(
        msg.toNumber,
        msg.from,
        mediaUrl,
        accountSid,
        authToken,
        undefined,
        kindOverride ?? mediaKind
      );
      await logMessage({
        business_slug,
        role: "assistant",
        content: `[media] ${mediaUrl}`,
        model_used: "opening_media",
        session_id: sessionId,
      });
    };
    try {
      await attempt();
      return true;
    } catch (e) {
      console.error("[WA Webhook] sending opening media failed (retrying once):", {
        mediaUrl,
        mediaKind,
        provider: msg.toNumber?.trim()?.match(/^\d+$/) ? "meta_or_twilio" : "unknown",
        e,
      });
      try {
        await sleepMs(250);
        // Retry once with auto-detection (kindOverride undefined) in case the configured type mismatched the URL.
        await attempt(undefined);
        return true;
      } catch (e2) {
        console.error("[WA Webhook] sending opening media failed (giving up):", { mediaUrl, mediaKind, e: e2 });
        return false;
      }
    }
  };

  // New lead flow: optional media first, then a default opening message (no AI)
  // If the user just opted back in, continue to Zoe instead of stopping on default opening.
  if (isNewLead && !optedInThisMessage) {
    const restartState = await restartSalesFlowFromGreeting({
      knowledge,
      salesFlowServices,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      blockTrialPickMedia: starterBlocksMedia,
      sendOpeningMediaIfConfigured,
      logModelUsed: "default_opening",
    });
    if (restartState.ranContinuation) {
      contactSessionPhase = restartState.contactSessionPhase;
      contactFlowStep = restartState.contactFlowStep;
      sfClickedCtaKinds = restartState.sfClickedCtaKinds;
      contactInstagramFollowPromptSent = restartState.contactInstagramFollowPromptSent;
      contactTrialRegistered = restartState.contactTrialRegistered;
      contactTrialRegisteredAt = restartState.contactTrialRegisteredAt;
      allowTrialCtaThisSession = restartState.allowTrialCtaThisSession;
    }
    return;
  }

  // ───────────────────── Priority routing (no Claude first) ───────────────────
  // 0) Greeting messages (deterministic) — don't send to Claude.
  if (msg.type === "text") {
    if (isSalesFlowStartInbound(msg)) {
      // «היי» / «בואו נתחיל» / «אשמח לשמוע פרטים» וכו׳ — מאפסים את הפלואו לסשן חדש; המרות קודמות נשמרות באירועי messages.
      const restartState = await restartSalesFlowFromGreeting({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        blockTrialPickMedia: starterBlocksMedia,
        sendOpeningMediaIfConfigured,
        logModelUsed: "greeting",
      });
      if (restartState.ranContinuation) {
        allowTrialCtaThisSession = restartState.allowTrialCtaThisSession;
        contactSessionPhase = restartState.contactSessionPhase;
        contactFlowStep = restartState.contactFlowStep;
        sfClickedCtaKinds = restartState.sfClickedCtaKinds;
        contactInstagramFollowPromptSent = restartState.contactInstagramFollowPromptSent;
        contactTrialRegistered = restartState.contactTrialRegistered;
        contactTrialRegisteredAt = restartState.contactTrialRegisteredAt;
      }
      return;
    }
  }

  // 0.5) חימום — בחירות תפריט (כולל list_reply / button_reply; inbound תמיד type:"text")
  const lastAssistForWarmupPriority = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
  const inWarmupMenuPickContext =
    contactSessionPhase === "warmup" || isWarmupExtraMenuModel(lastAssistForWarmupPriority);
  if (
    isWaInboundTextMessage(msg) &&
    knowledge?.salesFlowConfig &&
    knowledge.warmupSessionEnabled !== false &&
    businessId &&
    inWarmupMenuPickContext
  ) {
    try {
      const warmPickEarly = await attemptWarmupExtraMenuPick({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        contactSessionPhase,
        contactFlowStep,
        contactTrialRegistered,
        allowTrialCtaThisSession,
        sfClickedCtaKinds,
        contactInstagramFollowPromptSent,
        blockTrialPickMedia: starterBlocksMedia,
        debugTag: "priority-warmup-phase",
      });
      if (warmPickEarly.handled) {
        if (warmPickEarly.contactSessionPhase) contactSessionPhase = warmPickEarly.contactSessionPhase;
        if (warmPickEarly.contactFlowStep != null) contactFlowStep = warmPickEarly.contactFlowStep;
        return;
      }
    } catch (e) {
      console.error("[WA Webhook] Priority warmup pick failed:", e);
    }
  }

  // handoff / בקשת קשר — לפני repick (שומר על שלב השיחה)
  if (
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    businessId &&
    isSalesFlowFreeTextInbound(msg) &&
    (await trySendSalesFlowHumanAgentHandoff({
      inboundText: msg.text.trim(),
      knowledge,
      msg,
      accountSid,
      authToken,
      business_slug,
      sessionId,
    }))
  ) {
    return;
  }

  // explicit service switch (כל phase) — repick menu
  if (
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    businessId &&
    salesFlowServices.length > 1 &&
    isSalesFlowFreeTextInbound(msg)
  ) {
    const lastPickedForExplicitSwitch = await fetchLastSfServiceEventName({
      business_slug,
      session_id: sessionId,
    });
    const serviceNamesForSwitch = salesFlowServices.map((s) => s.name.trim()).filter(Boolean);
    if (
      isPhaseAgnosticExplicitServiceSwitch(
        msg.text.trim(),
        lastPickedForExplicitSwitch,
        serviceNamesForSwitch
      )
    ) {
      await sendSalesFlowServiceRepickAckAndMenu({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        blockMedia: starterBlocksMedia,
        logModelUsed: "sales_flow_explicit_service_repick",
      });
      contactSessionPhase = "opening";
      contactFlowStep = 0;
      contactScheduleRequestedDate = "";
      contactScheduleRequestedTime = "";
      return;
    }
  }

  // מספר אחרי תפריט repick — רק awaiting-pick
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId && salesFlowServices.length > 1) {
    const awaitingServicePickForNumeric =
      isSalesFlowMultiServicePickPhase(contactSessionPhase) ||
      (contactSessionPhase === "cta" &&
        (await assistantAwaitingServiceRepickPick({ business_slug, session_id: sessionId })));
    if (awaitingServicePickForNumeric && isNumericServicePickReply(msg.text.trim())) {
      if (contactSessionPhase === "cta") {
        const phoneVariants = contactPhoneLookupVariants(msg.from);
        await supabase
          .from("contacts")
          .update(salesFlowOpeningResetPatch())
          .eq("business_id", businessId)
          .in("phone", phoneVariants.length ? phoneVariants : [msg.from]);
        contactSessionPhase = "opening";
        contactFlowStep = 0;
        contactScheduleRequestedDate = "";
        contactScheduleRequestedTime = "";
      }
    }
  }

  // 1) Sales flow: בחירת שירות (מרובים) → מענה + שאלת ניסיון (לא בשלב חימום — «1» לא ייבחר בטעות כשירות ראשון)
  if (
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    businessId &&
    salesFlowServices.length > 1 &&
    isSalesFlowMultiServicePickPhase(contactSessionPhase)
  ) {
    try {
      const named = salesFlowServices;
      const serviceLabels = named.map((s) => s.name.trim()).filter(Boolean);
      const resolved = resolveWaMenuChoice(
        msg.text,
        msg.metaInteractiveReplyId,
        serviceLabels,
        serviceLabels
      ).trim();
      const rawLower = resolved.toLowerCase();
      const num = Number(rawLower);
      const picked =
        Number.isFinite(num) && num >= 1 && num <= named.length
          ? named[num - 1]
          : named.find((s) => waLabelMatches(resolved, s.name)) ??
            named.find((s) => s.name.trim().toLowerCase() === rawLower) ??
            named.find((s) => rawLower && s.name.toLowerCase().includes(rawLower)) ??
            named.find((s) => rawLower && rawLower.includes(s.name.toLowerCase()));

      if (picked) {
        const cfg = knowledge.salesFlowConfig;
        const afterPick = fillAfterServicePickTemplate(cfg.after_service_pick, picked.name, picked.benefit, {
          priceText: picked.priceText,
          durationText: picked.durationText,
          businessAddress: knowledge.addressText ?? "",
          sessionsText: picked.courseSessionsText,
          schedulePhrase: buildCourseSchedulePhraseForCta(picked.courseCycles ?? []),
          offerKind: picked.offerKind,
        });
        if (!starterBlocksMedia && !picked.trialPickMediaUrl?.trim()) {
          console.warn(
            `[WA Webhook] sf_service_pick: מדיה למסלול שיעור הניסיון חסרה ב-DB בשירות "${picked.name}" (בודקים ש-description כולל trial_pick_media_url בשמירת ההגדרות).`
          );
        }

        await sendTrialPickMediaIfAllowed({
          blockMedia: starterBlocksMedia,
          mediaUrl: picked.trialPickMediaUrl,
          mediaType: picked.trialPickMediaType,
          msg,
          accountSid,
          authToken,
          business_slug,
          sessionId,
        });
        if (afterPick.trim()) {
          await sendWhatsAppMessage(msg.toNumber, msg.from, afterPick.trim(), accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send sales-flow pick reply failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: afterPick.trim(),
            model_used: "sales_flow",
            session_id: sessionId,
          });
        }
        await logMessage({
          business_slug,
          role: "event",
          content: `${HEYZOE_SF_SERVICE_PREFIX}${picked.name}`,
          model_used: "sf_service_pick",
          session_id: sessionId,
        });
        const nextPhase = scheduleSelectionPhaseAfterService(knowledge, picked);
        const phoneVariantsAfterPick = contactPhoneLookupVariants(msg.from);
        await supabase
          .from("contacts")
          .update(
            withWarmupExtraAwaitingOff({
              session_phase: nextPhase,
              flow_step: 0,
              sf_requested_date: null,
              sf_requested_time: null,
            })
          )
          .eq("business_id", businessId)
          .in("phone", phoneVariantsAfterPick.length ? phoneVariantsAfterPick : [msg.from]);
        contactSessionPhase = nextPhase;
        contactFlowStep = 0;
        await sendFlowContinuation({
          phase: nextPhase,
          contact: { flow_step: 0 },
          knowledge,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          salesFlowServices,
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
          blockTrialPickMedia: starterBlocksMedia,
          sfConsumedKinds: sfClickedCtaKinds,
          instagramFollowPromptSent: contactInstagramFollowPromptSent,
        });
        return;
      }
    } catch (e) {
      console.warn("[WA Webhook] Sales-flow service pick failed (continuing):", e);
    }
  }

  // Global escape hatch: "בחירת אימון אחר" should always route back to service selection menu,
  // even if session_phase drifted and would otherwise fall into the open-ended AI path.
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId && salesFlowServices.length > 1) {
    const label = SCHEDULE_PICK_CHANGE_SERVICE_LABEL;
    const incomingResolved =
      msg.metaInteractiveReplyId?.trim()
        ? resolveMetaInteractiveLabel(msg.metaInteractiveReplyId, msg.text, [label])
        : msg.text.trim();
    if (waLabelMatches(incomingResolved, label)) {
      const phoneVariants = contactPhoneLookupVariants(msg.from);
      await supabase
        .from("contacts")
        .update(salesFlowOpeningResetPatch())
        .eq("business_id", businessId)
        .in("phone", phoneVariants.length ? phoneVariants : [msg.from]);
      contactScheduleRequestedDate = "";
      contactScheduleRequestedTime = "";
      contactSessionPhase = "opening";
      contactFlowStep = 0;

      await sendOpeningServicePickMenu({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        business_slug,
        sessionId,
        blockMedia: starterBlocksMedia,
        skipScheduleBoard: true,
      });
      return;
    }
  }

  // implicit service switch — רק awaiting-pick (שם מלא/חד-משמעי)
  if (
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    businessId &&
    salesFlowServices.length > 1 &&
    isSalesFlowFreeTextInbound(msg)
  ) {
    const awaitingServicePickForImplicit =
      isSalesFlowMultiServicePickPhase(contactSessionPhase) ||
      (await assistantAwaitingServiceRepickPick({ business_slug, session_id: sessionId }));
    if (awaitingServicePickForImplicit) {
      const lastPickedForRepick = await fetchLastSfServiceEventName({ business_slug, session_id: sessionId });
      const switchServices = salesFlowServices.map((s) => ({ name: s.name, offerKind: s.offerKind }));
      const implicitSwitch = lastPickedForRepick?.trim()
        ? resolveImplicitServiceSwitchFromFreeText({
            text: msg.text.trim(),
            lastPickedServiceName: lastPickedForRepick,
            services: switchServices,
            awaitingServicePick: true,
          })
        : null;

      if (implicitSwitch?.mode === "switch") {
        contactSessionPhase = await commitImplicitServiceSwitch({
          knowledge,
          salesFlowServices,
          serviceName: implicitSwitch.serviceName,
          msg,
          supabase,
          businessId,
          sessionId,
          business_slug,
        });
        contactFlowStep = 0;
        contactScheduleRequestedDate = "";
        contactScheduleRequestedTime = "";
        await sendFlowContinuation({
          phase: contactSessionPhase,
          contact: { flow_step: 0 },
          knowledge,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          salesFlowServices,
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
          blockTrialPickMedia: starterBlocksMedia,
          sfConsumedKinds: sfClickedCtaKinds,
          instagramFollowPromptSent: contactInstagramFollowPromptSent,
        });
        return;
      } else if (implicitSwitch?.mode === "ambiguous") {
        await sendSalesFlowServiceRepickAckAndMenu({
          knowledge,
          salesFlowServices,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          blockMedia: starterBlocksMedia,
          logModelUsed: "sales_flow_free_text_service_repick",
        });
        contactSessionPhase = "opening";
        contactFlowStep = 0;
        contactScheduleRequestedDate = "";
        contactScheduleRequestedTime = "";
        return;
      }
    }
  }

  // 1.5) Sales flow: בחירת מועד ממערכת שעות (list_reply/כפתורים) + תאריך/שעה חופשיים
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId) {
    try {
      if (
        await trySendSalesFlowHumanAgentHandoff({
          inboundText: msg.text.trim(),
          knowledge,
          msg,
          accountSid,
          authToken,
          business_slug,
          sessionId,
        })
      ) {
        return;
      }

      const selectedServiceName =
        salesFlowServices.length === 1
          ? salesFlowServices[0]!.name
          : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
      const selectedService =
        salesFlowServices.find((service) => service.name === selectedServiceName) ?? salesFlowServices[0] ?? null;
      const inSchedulePhase =
        contactSessionPhase === "schedule_date" || contactSessionPhase === "schedule_time";

      if (shouldCollectCourseCycleStartPick(knowledge, selectedService)) {
        const cyclesForButtons = courseCyclesForStartButtons(selectedService?.courseCycles ?? []).slice(
          0,
          SCHEDULE_SLOT_PICK_MAX - 1
        );
        if (cyclesForButtons.length > 0) {
          const labels = cyclesForButtons.map((c) => formatCourseCycleStartButtonLabel(c.start_date));
          labels.push(SCHEDULE_PICK_CHANGE_SERVICE_LABEL);
          const resolved = resolveWaMenuChoice(msg.text.trim(), msg.metaInteractiveReplyId, labels, labels);
          const lastAssistForSchedule = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
          const inCoursePickContext =
            !["opening", "warmup", "cta", "registered"].includes(contactSessionPhase) &&
            (inSchedulePhase || lastAssistForSchedule === "sales_flow_course_cycle_start_menu");

          if (waLabelMatches(resolved, SCHEDULE_PICK_CHANGE_SERVICE_LABEL)) {
            const phoneVariants = contactPhoneLookupVariants(msg.from);
            await supabase
              .from("contacts")
              .update(salesFlowOpeningResetPatch())
              .eq("business_id", businessId)
              .in("phone", phoneVariants.length ? phoneVariants : [msg.from]);
            contactScheduleRequestedDate = "";
            contactScheduleRequestedTime = "";
            contactSessionPhase = "opening";
            contactFlowStep = 0;
            await sendOpeningServicePickMenu({
              knowledge,
              salesFlowServices,
              msg,
              accountSid,
              authToken,
              business_slug,
              sessionId,
              blockMedia: starterBlocksMedia,
              skipScheduleBoard: true,
            });
            return;
          }

          const idx = labels.findIndex((l) => courseCycleStartButtonLabelsMatch(l, resolved));
          if (idx >= 0) {
            const cycle = cyclesForButtons[idx]!;
            const dateTxt = formatCycleDateShort(cycle.start_date);
            const phoneVariants = contactPhoneLookupVariants(msg.from);
            const nextPhase = phaseAfterSchedulePickComplete();
            const { error } = await supabase
              .from("contacts")
              .update(
                withWarmupExtraAwaitingOff({
                  sf_requested_date: dateTxt,
                  sf_requested_time: "",
                  session_phase: nextPhase,
                  flow_step: 0,
                })
              )
              .eq("business_id", businessId)
              .in("phone", phoneVariants.length ? phoneVariants : [msg.from]);
            if (error) console.warn("[WA Webhook] course cycle start pick update failed:", error.message);
            contactScheduleRequestedDate = dateTxt;
            contactScheduleRequestedTime = "";
            contactSessionPhase = nextPhase;
            const serviceLabel = selectedService?.name?.trim() || "הקורס";
            const afterTpl =
              (knowledge.salesFlowConfig?.after_course_cycle_pick ?? "").trim() ||
              "מעולה! רשמנו שתרצו להתחיל את {serviceName} בתאריך {requested_date}.";
            const afterScheduleText = fillAfterCourseCyclePickTemplate(afterTpl, serviceLabel, dateTxt);
            await sendWhatsAppMessage(msg.toNumber, msg.from, afterScheduleText, accountSid, authToken).catch((e) =>
              console.error("[WA Webhook] Send after course cycle pick failed:", e)
            );
            await logMessage({
              business_slug,
              role: "assistant",
              content: afterScheduleText,
              model_used: "sales_flow_after_course_cycle_pick",
              session_id: sessionId,
            });
            await sendSalesFlowCtaMenuWithPhaseUpdate({
              knowledge,
              msg,
              accountSid,
              authToken,
              supabase,
              businessId,
              business_slug,
              sessionId,
              salesFlowServices,
              trialRegistered: contactTrialRegistered,
              allowTrialCta: allowTrialCtaThisSession,
              sfConsumedKinds: sfClickedCtaKinds,
              modelUsed: "sales_flow_cta",
            });
            return;
          }

          if (inCoursePickContext && shouldResendDeterministicMenuOnUnrecognizedPick(msg)) {
            const txt = "לא זיהיתי את המחזור. בחרו מהאפשרויות למטה (או כתבו את המספר).";
            await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
            await logMessage({
              business_slug,
              role: "assistant",
              content: txt,
              model_used: "sales_flow_course_cycle_start_invalid",
              session_id: sessionId,
            });
            await sendCourseCycleStartPickMenu({
              knowledge,
              selectedService,
              blockMedia: starterBlocksMedia,
              msg,
              accountSid,
              authToken,
              supabase,
              businessId,
              business_slug,
              sessionId,
            });
            return;
          }
        }
      } else if (!shouldCollectScheduleSelection(knowledge, selectedService)) {
        if (inSchedulePhase) {
          await sendSalesFlowCtaMenuWithPhaseUpdate({
            knowledge,
            msg,
            accountSid,
            authToken,
            supabase,
            businessId,
            business_slug,
            sessionId,
            salesFlowServices,
            trialRegistered: contactTrialRegistered,
            allowTrialCta: allowTrialCtaThisSession,
            sfConsumedKinds: sfClickedCtaKinds,
            modelUsed: "sales_flow_cta",
          });
          return;
        }
      } else {
        const slotsForPick = (selectedService?.scheduleSlots ?? []).slice(0, SCHEDULE_SLOT_PICK_MAX);
        if (slotsForPick.length > 0) {
          const labels = slotsForPick
            .slice(0, Math.max(0, SCHEDULE_SLOT_PICK_MAX - 1))
            .map((s) =>
              formatSlotPickButtonLabelWithCycle(s, { start_date: s.cycle_start, end_date: s.cycle_end })
            );
          labels.push(SCHEDULE_PICK_CHANGE_SERVICE_LABEL);
          const resolved = resolveWaMenuChoice(msg.text.trim(), msg.metaInteractiveReplyId, labels, labels);
          const lastAssistForSchedule = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
          // רק כשבאמת בשלב מועד — לא לפי metaInteractiveReplyId (גם CTA/חימום/בחירת שירות הם interactive).
          const inSchedulePickContext =
            !["opening", "warmup", "cta", "registered"].includes(contactSessionPhase) &&
            (inSchedulePhase || lastAssistForSchedule === "sales_flow_schedule_slot_menu");

          if (waLabelMatches(resolved, SCHEDULE_PICK_CHANGE_SERVICE_LABEL)) {
          const phoneVariants = contactPhoneLookupVariants(msg.from);
          await supabase
            .from("contacts")
            .update(salesFlowOpeningResetPatch())
            .eq("business_id", businessId)
            .in("phone", phoneVariants.length ? phoneVariants : [msg.from]);
          contactScheduleRequestedDate = "";
          contactScheduleRequestedTime = "";
          contactSessionPhase = "opening";
          contactFlowStep = 0;
          await sendOpeningServicePickMenu({
            knowledge,
            salesFlowServices,
            msg,
            accountSid,
            authToken,
            business_slug,
            sessionId,
            blockMedia: starterBlocksMedia,
            skipScheduleBoard: true,
          });
          return;
          }
          const idx = labels.findIndex((l) => scheduleSlotPickLabelsMatch(l, resolved));
          if (idx >= 0) {
            const slot = slotsForPick[idx]!;
        const dateTxt = formatDayNameForScheduleDatePlaceholder(slot.day);
        const timeTxt = slot.time;
        const phoneVariants = contactPhoneLookupVariants(msg.from);
        const nextPhase = phaseAfterSchedulePickComplete();
        const { error } = await supabase
          .from("contacts")
          .update(
            withWarmupExtraAwaitingOff({
              sf_requested_date: dateTxt,
              sf_requested_time: timeTxt,
              session_phase: nextPhase,
              flow_step: 0,
            })
          )
          .eq("business_id", businessId)
          .in("phone", phoneVariants.length ? phoneVariants : [msg.from]);
        if (error) console.warn("[WA Webhook] schedule slot pick update failed:", error.message);
        contactScheduleRequestedDate = dateTxt;
        contactScheduleRequestedTime = timeTxt;
        contactSessionPhase = nextPhase;
        const schedOfferKind = selectedService?.offerKind ?? "trial";
        const schedServiceFallback =
          schedOfferKind === "workshop" ? "הסדנה" : schedOfferKind === "course" ? "הקורס" : "האימון";
        const rawTpl = resolveAfterScheduleSelectionTemplate(knowledge.salesFlowConfig, schedOfferKind);
        const afterScheduleText = fillAfterScheduleSelectionTemplate(
          rawTpl,
          selectedService?.name?.trim() || schedServiceFallback,
          dateTxt,
          timeTxt
        );
        await sendWhatsAppMessage(msg.toNumber, msg.from, afterScheduleText, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send after schedule selection failed:", e)
        );
        await logMessage({
          business_slug,
          role: "assistant",
          content: afterScheduleText,
          model_used: "sales_flow_after_schedule_selection",
          session_id: sessionId,
        });
        await sendSalesFlowCtaMenuWithPhaseUpdate({
          knowledge,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          salesFlowServices,
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
          sfConsumedKinds: sfClickedCtaKinds,
          modelUsed: "sales_flow_cta",
        });
            return;
          }
          if (inSchedulePickContext && shouldResendDeterministicMenuOnUnrecognizedPick(msg)) {
            const txt = "לא זיהיתי את המועד. בחרו מהאפשרויות למטה (או כתבו את המספר של המועד).";
            await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
            await logMessage({
              business_slug,
              role: "assistant",
              content: txt,
              model_used: "sales_flow_schedule_slot_invalid",
              session_id: sessionId,
            });
            await sendScheduleSlotPickMenu({
              knowledge,
              selectedService,
              blockMedia: starterBlocksMedia,
              msg,
              accountSid,
              authToken,
              supabase,
              businessId,
              business_slug,
              sessionId,
            });
            return;
          }
        }

        if (inSchedulePhase && slotsForPick.length === 0) {
      if (contactSessionPhase === "schedule_date") {
        const parsedDate = parseScheduleDateInput(msg.text);
        if (!parsedDate) {
          if (shouldResendDeterministicMenuOnUnrecognizedPick(msg)) {
            const txt = "לא הצלחתי לזהות את התאריך, נסה שוב בפורמט: 24.5";
            await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
            await logMessage({
              business_slug,
              role: "assistant",
              content: txt,
              model_used: "sales_flow_schedule_date_invalid",
              session_id: sessionId,
            });
            return;
          }
        } else {
          const { error } = await supabase
            .from("contacts")
            .update(
              withWarmupExtraAwaitingOff({
                sf_requested_date: parsedDate,
                session_phase: "schedule_time",
                flow_step: 0,
              })
            )
            .eq("business_id", businessId)
            .in("phone", contactPhoneLookupVariants(msg.from));
          if (error) console.warn("[WA Webhook] sf_requested_date update failed:", error.message);
          contactScheduleRequestedDate = parsedDate;
          contactSessionPhase = "schedule_time";
          await sendScheduleSelectionTimeQuestion({
            selectedService,
            msg,
            accountSid,
            authToken,
            supabase,
            businessId,
            business_slug,
            sessionId,
          });
          return;
        }
      }

      const parsedTime = parseScheduleTimeInput(msg.text);
      if (!parsedTime) {
        const maybeDate = parseScheduleDateInput(msg.text);
        const dow = maybeDate ? heDayOfWeekForDm(maybeDate) : null;
        const datePrefix =
          maybeDate && dow ? `תודה! ${maybeDate} זה ${dow}.` : maybeDate ? `תודה! ${maybeDate}.` : "";
        const sideAnswer = datePrefix || buildScheduleTimeSideAnswer(msg.text, knowledge, selectedService);
        if (!sideAnswer && !shouldResendDeterministicMenuOnUnrecognizedPick(msg)) {
          // טקסט חופשי — ממשיך ל-Claude; תפריט מועד אחרי התשובה.
        } else {
          const txt = sideAnswer
            ? `${sideAnswer}\n\n${buildScheduleTimeQuestion(selectedService)}`
            : "לא הצלחתי לזהות את השעה, נסה שוב בפורמט: 19:00";
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
          await logMessage({
            business_slug,
            role: "assistant",
            content: txt,
            model_used: sideAnswer ? "sales_flow_schedule_time_reask" : "sales_flow_schedule_time_invalid",
            session_id: sessionId,
          });
          return;
        }
      } else {
        const nextPhaseLegacy = phaseAfterSchedulePickComplete();
        const { error: timeUpErr } = await supabase
          .from("contacts")
          .update(
            withWarmupExtraAwaitingOff({
              sf_requested_time: parsedTime,
              session_phase: nextPhaseLegacy,
              flow_step: 0,
            })
          )
          .eq("business_id", businessId)
          .in("phone", contactPhoneLookupVariants(msg.from));
        if (timeUpErr) console.warn("[WA Webhook] sf_requested_time update failed:", timeUpErr.message);
        contactScheduleRequestedTime = parsedTime;
        contactSessionPhase = nextPhaseLegacy;
        const schedOfferKindLegacy = selectedService?.offerKind ?? "trial";
        const schedServiceFallbackLegacy =
          schedOfferKindLegacy === "workshop"
            ? "הסדנה"
            : schedOfferKindLegacy === "course"
              ? "הקורס"
              : "האימון";
        const rawTplLegacy = resolveAfterScheduleSelectionTemplate(
          knowledge.salesFlowConfig,
          schedOfferKindLegacy
        );
        const afterScheduleTextLegacy = fillAfterScheduleSelectionTemplate(
          rawTplLegacy,
          selectedService?.name?.trim() || schedServiceFallbackLegacy,
          String(contactScheduleRequestedDate || "").trim() || "המועד שבחרת",
          parsedTime
        );
        await sendWhatsAppMessage(msg.toNumber, msg.from, afterScheduleTextLegacy, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send after schedule selection failed:", e)
        );
        await logMessage({
          business_slug,
          role: "assistant",
          content: afterScheduleTextLegacy,
          model_used: "sales_flow_after_schedule_selection",
          session_id: sessionId,
        });
        await sendSalesFlowCtaMenuWithPhaseUpdate({
          knowledge,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          salesFlowServices,
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
          sfConsumedKinds: sfClickedCtaKinds,
          modelUsed: "sales_flow_cta",
        });
        return;
      }
        }
      }
    } catch (e) {
      console.warn("[WA Webhook] Sales-flow schedule selection failed (continuing):", e);
    }
  }

  // 2) Sales flow: כפתורי CTA / תפריט המשך (לפני זיהוי שאלת ניסיון — כדי ש־1/2/3 יתאימו לתפריט הנוכחי)
  if (msg.type === "text" && knowledge?.salesFlowConfig && businessId && contactSessionPhase !== "warmup") {
    const lastAssistModelForCta = await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId });
    const digitOnlyForCta = /^[1-9]$/.test(msg.text.trim());
    const skipCtaBlockForDigit =
      digitOnlyForCta &&
      lastAssistModelForCta !== "sales_flow_cta" &&
      lastAssistModelForCta !== "sales_flow_post_link_menu";

    if (!skipCtaBlockForDigit) {
      try {
        const cfg = knowledge.salesFlowConfig!;
        const follow = cfg.followup_after_next_class_options;

        const selectedServiceName =
          salesFlowServices.length === 1
            ? salesFlowServices[0]!.name
            : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
        const selectedService =
          salesFlowServices.find((service) => service.name === selectedServiceName) ?? salesFlowServices[0] ?? null;

        const activeOfferKind = selectedService?.offerKind ?? "trial";
        const ctaBs = ctaButtonsForOfferKind(cfg, activeOfferKind);

        const sfEff: EffectiveSalesFlowCtaInput = {
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
          consumedNonTrialKinds: new Set(sfClickedCtaKinds),
        };
        const effectiveCtas =
          activeOfferKind === "trial"
            ? getEffectiveSalesFlowCtaButtons(ctaBs, sfEff)
            : getEffectiveSecondaryOfferCtaButtons(ctaBs, sfClickedCtaKinds);
        const effFollowLabels = getEffectiveFollowupMenuLabels(cfg.followup_after_next_class_options, sfEff, cfg.cta_buttons);
        const unionLabels = [...ctaBs.map((b) => b.label.trim()), ...follow.map((x) => String(x ?? "").trim())].filter(
          (l) => l.length > 0
        );

        const fuOptsForNum = effFollowLabels;
        const ctaOptsForNum = effectiveCtas.map((b) => b.label.trim()).filter(Boolean).slice(0, 12);
        const numericScope =
          lastAssistModelForCta === "sales_flow_post_link_menu"
            ? fuOptsForNum
            : lastAssistModelForCta === "sales_flow_cta"
              ? ctaOptsForNum
              : undefined;

        const incomingResolved = resolveWaMenuChoice(
          msg.text.trim(),
          msg.metaInteractiveReplyId,
          unionLabels.length ? unionLabels : ctaBs.map((b) => b.label),
          numericScope
        );

        const trialUrl = (
          selectedService?.paymentLink?.trim() ||
          salesFlowServices.map((s) => s.paymentLink?.trim()).find((u) => u && u.length > 0) ||
          ""
        ).trim();
        const scheduleUrlFull = (knowledge.schedulePublicUrl?.trim() || knowledge.arboxLink?.trim() || "").trim();
        const csPhone = knowledge?.customerServicePhone?.trim() ?? "";

        const consumedSf = (k: string) => sfClickedCtaKinds.includes(k);
        const trialBtn = ctaBs.find((b) => b.kind === "trial");
        const schedBtn =
          ctaBs.find((b) => b.kind === "schedule") ?? cfg.cta_buttons?.find((b) => b.kind === "schedule");
        const memBtn = ctaBs.find((b) => b.kind === "memberships");
        const addressBtn = ctaBs.find((b) => b.kind === "address");
        const trialCtaOn = Boolean(trialBtn && (trialBtn.trial_cta_delivery ?? "link") !== "none");
        const scheduleCtaOn = Boolean(schedBtn && (schedBtn.schedule_cta_delivery ?? "link") !== "none");
        const memCtaOn = Boolean(memBtn && (memBtn.memberships_cta_delivery ?? "link") !== "none");
        const wantsScheduleByIntent = scheduleCtaOn && isScheduleIntent(incomingResolved);
        const wantsTrialByFollow =
          trialCtaOn && Boolean(follow[0] && waLabelMatches(incomingResolved, follow[0]));
        const wantsScheduleByFollow =
          scheduleCtaOn &&
          Boolean(follow[1] && waLabelMatches(incomingResolved, follow[1]) && !consumedSf("schedule"));
        const wantsMembershipsByFollow =
          memCtaOn &&
          Boolean(follow[2] && waLabelMatches(incomingResolved, follow[2]) && !consumedSf("memberships"));
        const wantsTrial =
          wantsTrialByFollow ||
          (trialCtaOn && trialBtn ? waLabelMatches(incomingResolved, trialBtn.label) : false);
        const wantsSchedule =
          wantsScheduleByIntent ||
          (!consumedSf("schedule") &&
            (wantsScheduleByFollow ||
              (scheduleCtaOn && schedBtn ? waLabelMatches(incomingResolved, schedBtn.label) : false)));
        const wantsMemberships =
          memCtaOn &&
          !consumedSf("memberships") &&
          (wantsMembershipsByFollow || (memBtn ? waLabelMatches(incomingResolved, memBtn.label) : false));
        const wantsAddressByButton =
          !consumedSf("address") &&
          Boolean(addressBtn && waLabelMatches(incomingResolved, addressBtn.label));
        const wantsAddressByIntent =
          !consumedSf("address") && isAddressOrDirectionsIntent(incomingResolved);
        const wantsAddress = wantsAddressByButton || wantsAddressByIntent;

        const sendPostLinkMenu = async (): Promise<void> => {
          const fuBody = cfg.followup_after_next_class_body.trim();
          const menuLabelsRaw = getEffectiveFollowupMenuLabels(
            cfg.followup_after_next_class_options,
            {
              trialRegistered: contactTrialRegistered,
              allowTrialCta: allowTrialCtaThisSession,
              consumedNonTrialKinds: new Set(sfClickedCtaKinds),
            },
            cfg.cta_buttons
          );
          const menuLabels = menuLabelsRaw.slice(0, 12);
          if (!fuBody || menuLabels.length < 1) return;
          const postLinkMenuFooter = salesFlowMenuFooter(knowledge);
          const postLinkContentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
          const logged = [
            fuBody.trim(),
            menuLabels.map((label, index) => `${index + 1}. ${label}`).join("\n"),
            postLinkMenuFooter,
          ]
            .filter((x) => x.length > 0)
            .join("\n\n");
          await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, fuBody.trim(), menuLabels, accountSid, authToken, {
            footerHint: postLinkMenuFooter,
            language: postLinkContentLang,
          }).catch((e) => console.error("[WA Webhook] Send post-link menu failed:", e));
          await logMessage({
            business_slug,
            role: "assistant",
            content: logged,
            model_used: "sales_flow_post_link_menu",
            session_id: sessionId,
          });
        };

        if (wantsTrial && contactTrialRegistered === true && !allowTrialCtaThisSession) {
          const contentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
          const igRaw = knowledge?.instagramUrl?.trim() ?? "";
          const includeIg = igRaw.length > 0 && !contactInstagramFollowPromptSent;
          const soft = [
            trialAlreadyRegisteredSoftIntro(contentLang),
            includeIg ? instagramFollowLine(contentLang, igRaw) : "",
            trialAlreadyRegisteredSoftClosing(contentLang),
          ]
            .filter(Boolean)
            .join("\n\n");
          await sendWhatsAppMessage(msg.toNumber, msg.from, soft, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send post-trial soft reply failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: soft,
            model_used: "sales_flow_trial_already_registered",
            session_id: sessionId,
          });
          if (businessId && includeIg) {
            const igUp = await supabase
              .from("contacts")
              .update({ instagram_follow_prompt_sent: true })
              .eq("business_id", businessId)
              .eq("phone", msg.from);
            if (igUp.error) console.warn("[WA Webhook] instagram_follow_prompt_sent (trial soft):", igUp.error.message);
            else contactInstagramFollowPromptSent = true;
          }
          return;
        }

        if (wantsTrial && trialUrl) {
          if (businessId) {
            try {
              const { markRegistrationCtaClicked } = await import("@/lib/notifications/conversations");
              void markRegistrationCtaClicked({ businessId, phone: msg.from, sessionId });
            } catch (e) {
              console.warn("[WA Webhook] markRegistrationCtaClicked failed:", e);
            }
          }
          const contentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
          const postCtaHint = trialLinkPostCtaMessage(contentLang);
          const txt = `${trialSignupLinkIntro(contentLang)}\n${trialUrl}`;
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send trial link failed:", e)
          );
          await sendWhatsAppMessage(msg.toNumber, msg.from, postCtaHint, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send trial link post-CTA hint failed:", e)
          );
          const logged = `${txt}\n\n${postCtaHint}`;
          await logMessage({
            business_slug,
            role: "assistant",
            content: logged,
            model_used: "sales_flow_trial_link",
            session_id: sessionId,
          });
          return;
        }
        if (wantsTrial && !trialUrl) {
          const contentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
          const txt = trialSignupLinkMissing(contentLang);
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
          await logMessage({
            business_slug,
            role: "assistant",
            content: txt,
            model_used: "sales_flow_trial_missing",
            session_id: sessionId,
          });
          return;
        }

        const workshopBuyBtn = ctaBs.find((b) => b.kind === "workshop_purchase");
        const workshopContactBtn = ctaBs.find((b) => b.kind === "workshop_contact");
        const courseEnrollBtn = ctaBs.find((b) => b.kind === "course_enroll");
        const courseContactBtn = ctaBs.find((b) => b.kind === "course_contact");

        if (
          activeOfferKind === "workshop" &&
          workshopBuyBtn &&
          waLabelMatches(incomingResolved, workshopBuyBtn.label) &&
          !consumedSf("workshop_purchase")
        ) {
          const del = workshopBuyBtn.secondary_purchase_delivery ?? "link";
          if (del === "link" && trialUrl) {
            if (businessId) {
              const { markRegistrationCtaClicked } = await import("@/lib/notifications/conversations");
              void markRegistrationCtaClicked({ businessId, phone: msg.from, sessionId });
            }
            const txt = `מעולה! נרשמים כאן:\n${trialUrl}`;
            await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
              console.error("[WA Webhook] Send workshop link failed:", e)
            );
            await sendWhatsAppMessage(
              msg.toNumber,
              msg.from,
              SECONDARY_OFFER_PURCHASE_POST_CTA_MESSAGE,
              accountSid,
              authToken
            ).catch((e) => console.error("[WA Webhook] Send workshop post-hint failed:", e));
            sfClickedCtaKinds = await bumpSfConsumedCtaKind({
              supabase,
              businessId,
              phone: msg.from,
              kind: "workshop_purchase",
              previous: sfClickedCtaKinds,
            });
            await logMessage({
              business_slug,
              role: "assistant",
              content: `${txt}\n\n${SECONDARY_OFFER_PURCHASE_POST_CTA_MESSAGE}`,
              model_used: "sales_flow_workshop_link",
              session_id: sessionId,
            });
            return;
          }
          if (del === "phone" && csPhone) {
            await sendCustomerServiceRedirectWithServicePickFollowUp({
              csMessage: `מוזמנים להתקשר לשירות הלקוחות שלנו:\n${csPhone}`,
              modelUsed: "sales_flow_workshop_phone",
              knowledge,
              salesFlowServices,
              msg,
              accountSid,
              authToken,
              supabase,
              businessId,
              business_slug,
              sessionId,
            });
            sfClickedCtaKinds = await bumpSfConsumedCtaKind({
              supabase,
              businessId,
              phone: msg.from,
              kind: "workshop_purchase",
              previous: sfClickedCtaKinds,
            });
            contactSessionPhase = "opening";
            contactFlowStep = 0;
            return;
          }
          const txt = "כרגע אין כאן קישור או מספר לרכישה — כתבו לנו ונשמח לעזור.";
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
          await logMessage({
            business_slug,
            role: "assistant",
            content: txt,
            model_used: "sales_flow_workshop_purchase_missing",
            session_id: sessionId,
          });
          return;
        }

        if (
          activeOfferKind === "workshop" &&
          workshopContactBtn &&
          waLabelMatches(incomingResolved, workshopContactBtn.label) &&
          !consumedSf("workshop_contact")
        ) {
          const txt = csPhone
            ? `מוזמנים ליצור קשר:\n${csPhone}`
            : "מוזמנים לכתוב כאן ונחזור אליכם.";
          await sendCustomerServiceRedirectWithServicePickFollowUp({
            csMessage: txt,
            modelUsed: "sales_flow_workshop_contact",
            knowledge,
            salesFlowServices,
            msg,
            accountSid,
            authToken,
            supabase,
            businessId,
            business_slug,
            sessionId,
          });
          sfClickedCtaKinds = await bumpSfConsumedCtaKind({
            supabase,
            businessId,
            phone: msg.from,
            kind: "workshop_contact",
            previous: sfClickedCtaKinds,
          });
          contactSessionPhase = "opening";
          contactFlowStep = 0;
          return;
        }

        if (
          activeOfferKind === "course" &&
          courseEnrollBtn &&
          waLabelMatches(incomingResolved, courseEnrollBtn.label) &&
          !consumedSf("course_enroll")
        ) {
          const del = courseEnrollBtn.secondary_purchase_delivery ?? "link";
          if (del === "link" && trialUrl) {
            if (businessId) {
              const { markRegistrationCtaClicked } = await import("@/lib/notifications/conversations");
              void markRegistrationCtaClicked({ businessId, phone: msg.from, sessionId });
            }
            const txt = `מעולה! ההצטרפות כאן:\n${trialUrl}`;
            await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
              console.error("[WA Webhook] Send course link failed:", e)
            );
            await sendWhatsAppMessage(
              msg.toNumber,
              msg.from,
              SECONDARY_OFFER_PURCHASE_POST_CTA_MESSAGE,
              accountSid,
              authToken
            ).catch((e) => console.error("[WA Webhook] Send course post-hint failed:", e));
            sfClickedCtaKinds = await bumpSfConsumedCtaKind({
              supabase,
              businessId,
              phone: msg.from,
              kind: "course_enroll",
              previous: sfClickedCtaKinds,
            });
            await logMessage({
              business_slug,
              role: "assistant",
              content: `${txt}\n\n${SECONDARY_OFFER_PURCHASE_POST_CTA_MESSAGE}`,
              model_used: "sales_flow_course_link",
              session_id: sessionId,
            });
            return;
          }
          if (del === "phone" && csPhone) {
            await sendCustomerServiceRedirectWithServicePickFollowUp({
              csMessage: `מוזמנים להתקשר לשירות הלקוחות שלנו:\n${csPhone}`,
              modelUsed: "sales_flow_course_phone",
              knowledge,
              salesFlowServices,
              msg,
              accountSid,
              authToken,
              supabase,
              businessId,
              business_slug,
              sessionId,
            });
            sfClickedCtaKinds = await bumpSfConsumedCtaKind({
              supabase,
              businessId,
              phone: msg.from,
              kind: "course_enroll",
              previous: sfClickedCtaKinds,
            });
            contactSessionPhase = "opening";
            contactFlowStep = 0;
            return;
          }
          const txt = "כרגע אין כאן קישור או מספר להצטרפות — כתבו לנו ונשמח לעזור.";
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
          await logMessage({
            business_slug,
            role: "assistant",
            content: txt,
            model_used: "sales_flow_course_enroll_missing",
            session_id: sessionId,
          });
          return;
        }

        if (
          activeOfferKind === "course" &&
          courseContactBtn &&
          waLabelMatches(incomingResolved, courseContactBtn.label) &&
          !consumedSf("course_contact")
        ) {
          const txt = csPhone
            ? `מוזמנים ליצור קשר:\n${csPhone}`
            : "מוזמנים לכתוב כאן ונחזור אליכם.";
          await sendCustomerServiceRedirectWithServicePickFollowUp({
            csMessage: txt,
            modelUsed: "sales_flow_course_contact",
            knowledge,
            salesFlowServices,
            msg,
            accountSid,
            authToken,
            supabase,
            businessId,
            business_slug,
            sessionId,
          });
          sfClickedCtaKinds = await bumpSfConsumedCtaKind({
            supabase,
            businessId,
            phone: msg.from,
            kind: "course_contact",
            previous: sfClickedCtaKinds,
          });
          contactSessionPhase = "opening";
          contactFlowStep = 0;
          return;
        }

        if (wantsSchedule) {
          const imgConfigured = String(schedBtn?.schedule_cta_image_url ?? "").trim();
          const canSendScheduleImage =
            schedBtn?.schedule_cta_delivery === "image" &&
            imgConfigured.length > 0 &&
            !starterBlocksMedia;

          if (canSendScheduleImage) {
            const cap =
              scheduleUrlFull.trim().length > 0
                ? `צפייה במערכת השעות:\n${scheduleUrlFull.trim()}`
                : undefined;
            await sendTrialPickMediaIfAllowed({
              blockMedia: starterBlocksMedia,
              mediaUrl: imgConfigured,
              mediaType: "image",
              msg,
              accountSid,
              authToken,
              business_slug,
              sessionId,
              caption: cap,
            });
            sfClickedCtaKinds = await bumpSfConsumedCtaKind({
              supabase,
              businessId,
              phone: msg.from,
              kind: "schedule",
              previous: sfClickedCtaKinds,
            });
            if (!wantsScheduleByIntent) await sendPostLinkMenu();
            await logMessage({
              business_slug,
              role: "assistant",
              content: cap ? `[media] ${imgConfigured}\n\n${cap}` : `[media] ${imgConfigured}`,
              model_used: "sales_flow_schedule_image",
              session_id: sessionId,
            });
            return;
          }

          if (scheduleUrlFull.trim().length > 0) {
            const txt = `צפייה במערכת השעות:\n${scheduleUrlFull.trim()}`;
            await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
              console.error("[WA Webhook] Send schedule link failed:", e)
            );
            sfClickedCtaKinds = await bumpSfConsumedCtaKind({
              supabase,
              businessId,
              phone: msg.from,
              kind: "schedule",
              previous: sfClickedCtaKinds,
            });
            if (!wantsScheduleByIntent) await sendPostLinkMenu();
            await logMessage({
              business_slug,
              role: "assistant",
              content: txt,
              model_used: "sales_flow_schedule_link",
              session_id: sessionId,
            });
            return;
          }

          const txt = "מערכת השעות תתעדכן בקרוב - כתבו בקצרה ונעזור לקבוע מועד.";
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch(() => {});
          sfClickedCtaKinds = await bumpSfConsumedCtaKind({
            supabase,
            businessId,
            phone: msg.from,
            kind: "schedule",
            previous: sfClickedCtaKinds,
          });
          if (!wantsScheduleByIntent) await sendPostLinkMenu();
          await logMessage({
            business_slug,
            role: "assistant",
            content: txt,
            model_used: "sales_flow_schedule_missing",
            session_id: sessionId,
          });
          return;
        }

        if (wantsMemberships) {
          const memDelivery = memBtn?.memberships_cta_delivery ?? "link";
          const mu = knowledge?.membershipsUrl?.trim() ?? "";
          const promo = knowledge?.promotionsText?.trim() ?? "";
          const promoIsMemberships = promo && /(מנוי|מנויים|כרטיסי(?:ה|ות)|חבילה)/u.test(promo);

          if (memDelivery === "range") {
            const lo = String(memBtn?.memberships_price_range_min ?? "").trim();
            const hi = String(memBtn?.memberships_price_range_max ?? "").trim();
            let rangeLine = "";
            if (lo && hi) rangeLine = `בין ${lo} ₪ ל-${hi} ₪`;
            else if (lo) rangeLine = `מ-${lo} ₪`;
            else if (hi) rangeLine = `עד ${hi} ₪`;
            const txt =
              rangeLine.trim().length > 0
                ? `טווח מחירים למנויים/כרטיסיות: ${rangeLine}`
                : "לפרטים על טווח המחירים, צרו קשר ישירות עם הסטודיו 😊";
            await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
              console.error("[WA Webhook] Send memberships range reply failed:", e)
            );
            sfClickedCtaKinds = await bumpSfConsumedCtaKind({
              supabase,
              businessId,
              phone: msg.from,
              kind: "memberships",
              previous: sfClickedCtaKinds,
            });
            await sendPostLinkMenu();
            await logMessage({
              business_slug,
              role: "assistant",
              content: txt,
              model_used:
                rangeLine.trim().length > 0 ? "sales_flow_memberships_range" : "sales_flow_memberships_range_missing",
              session_id: sessionId,
            });
            return;
          }

          const txt = mu.length
            ? [`מחירי מנויים:`, mu, promoIsMemberships ? promo : ""].filter(Boolean).join("\n")
            : "לפרטים על מחירי המנויים, צרו קשר ישירות עם הסטודיו 😊";
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send memberships reply failed:", e)
          );
          sfClickedCtaKinds = await bumpSfConsumedCtaKind({
            supabase,
            businessId,
            phone: msg.from,
            kind: "memberships",
            previous: sfClickedCtaKinds,
          });
          if (mu.length) await sendPostLinkMenu();
          await logMessage({
            business_slug,
            role: "assistant",
            content: txt,
            model_used: mu.length ? "sales_flow_memberships_link" : "sales_flow_memberships_fallback",
            session_id: sessionId,
          });
          return;
        }

        const humanContactBtn = effectiveCtas.find((b) => b.kind === "human_contact");
        const wantsHumanContact =
          Boolean(humanContactBtn && waLabelMatches(incomingResolved, humanContactBtn.label));
        if (wantsHumanContact) {
          const txt = csPhone
            ? `אין בעיה, ניתן ליצור קשר עם נציג אנושי במספר: ${csPhone}`
            : "אין בעיה, ניתן ליצור קשר עם נציג אנושי. כתבו לנו ונחזור אליכם בהקדם.";
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send human-contact CTA reply failed:", e)
          );
          sfClickedCtaKinds = await bumpSfConsumedCtaKind({
            supabase,
            businessId,
            phone: msg.from,
            kind: "human_contact",
            previous: sfClickedCtaKinds,
          });
          await sendPostLinkMenu();
          await logMessage({
            business_slug,
            role: "assistant",
            content: txt,
            model_used: csPhone ? "sales_flow_human_contact" : "sales_flow_human_contact_no_phone",
            session_id: sessionId,
          });
          return;
        }

        if (wantsAddress) {
          const contentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
          const address = knowledge?.addressText?.trim() ?? "";
          const directions = knowledge?.directionsText?.trim() ?? "";
          const txt = formatAddressReplyLines(contentLang, address, directions);
          const directionsMediaUrl = knowledge?.directionsMediaUrl?.trim() ?? "";
          sfClickedCtaKinds = await bumpSfConsumedCtaKind({
            supabase,
            businessId,
            phone: msg.from,
            kind: "address",
            previous: sfClickedCtaKinds,
          });
          if (directionsMediaUrl && !starterBlocksMedia) {
            await sendWhatsAppMediaMessage(
              msg.toNumber,
              msg.from,
              directionsMediaUrl,
              accountSid,
              authToken,
              txt,
              knowledge?.directionsMediaType === "video"
                ? "video"
                : knowledge?.directionsMediaType === "image"
                  ? "image"
                  : undefined
            ).catch((e) => console.error("[WA Webhook] Send address media reply failed:", e));
            // WhatsApp can show a subsequent text/menu before media finishes processing on the client.
            // Delay the follow-up menu enough so the media+caption reliably appears first.
            await sleepMs(knowledge?.directionsMediaType === "video" ? 2200 : 1300);
          } else {
            await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
              console.error("[WA Webhook] Send address reply failed:", e)
            );
          }
          await logMessage({
            business_slug,
            role: "assistant",
            content: directionsMediaUrl ? `[media] ${directionsMediaUrl}\n\n${txt}` : txt,
            model_used: address ? "sales_flow_address" : "sales_flow_address_missing",
            session_id: sessionId,
          });
          if (address) {
            await sendPostLinkMenu();
          }
          return;
        }
      } catch (e) {
        console.warn("[WA Webhook] Sales-flow CTA handling failed (continuing):", e);
      }
    }
  }

  // 2.5) Sales flow: שאלות נוספות בסשן חימום (אחרי שאלת ניסיון קודם, לפני CTA)
  if (msg.type === "text" && knowledge?.salesFlowConfig && knowledge.warmupSessionEnabled !== false && businessId) {
    try {
      const warmPick = await attemptWarmupExtraMenuPick({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        contactSessionPhase,
        contactFlowStep,
        contactTrialRegistered,
        allowTrialCtaThisSession,
        sfClickedCtaKinds,
        contactInstagramFollowPromptSent,
        blockTrialPickMedia: starterBlocksMedia,
        debugTag: "section-2.5",
      });
      if (warmPick.handled) {
        if (warmPick.contactSessionPhase) contactSessionPhase = warmPick.contactSessionPhase;
        if (warmPick.contactFlowStep != null) contactFlowStep = warmPick.contactFlowStep;
        return;
      }
    } catch (e) {
      console.error("[WA Webhook] Warmup extra steps handling failed:", e);
    }
  }

  // 3) Sales flow: מענה על שאלת ניסיון קודם → הנעה לפעולה + תפריט CTA
  if (
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    knowledge.warmupSessionEnabled !== false &&
    businessId &&
    salesFlowServices.length >= 1
  ) {
    try {
      const cfg = knowledge.salesFlowConfig;
      const selectedServiceName =
        salesFlowServices.length === 1
          ? salesFlowServices[0]!.name
          : (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
      const selectedService = selectedServiceName.trim()
        ? (salesFlowServices.find((service) => service.name === selectedServiceName) ?? null)
        : null;
      const wb = resolveWarmupExperienceConfig(cfg);
      if (isWarmupExperienceQuestion1Configured(wb)) {
        const pickedIdx = findWaMenuOptionIndex(msg.text.trim(), msg.metaInteractiveReplyId, wb.options);
        const pickedExp = pickedIdx >= 0 ? wb.options[pickedIdx] : undefined;
        if (pickedExp && contactSessionPhase === "warmup") {
          const warmupServiceName =
            (selectedService?.name ?? selectedServiceName).trim() || undefined;
          const rawReply = resolveWarmupExperienceReply(
            wb.replies,
            pickedIdx,
            wb.afterExperienceRaw
          );
          const afterExperience = fillAfterExperienceTemplate(
            rawReply,
            selectedService?.levelsEnabled ?? false,
            selectedService?.levels ?? [],
            warmupServiceName
          ).trim();
          const steps = wb.extras;
          const cleanSteps = steps
            .map((s) => ({
              question: String((s as { question?: unknown }).question ?? "").trim(),
              options: Array.isArray((s as { options?: unknown }).options)
                ? (s as { options: unknown[] }).options.map((x) => String(x ?? "").trim())
                : [],
              replies: Array.isArray((s as { replies?: unknown }).replies)
                ? (s as { replies: unknown[] }).replies.map((x) => String(x ?? "").trim())
                : [],
            }))
            .filter((s) => s.question && s.options.filter(Boolean).length >= 2);
          if (cleanSteps.length > 0) {
            const first = cleanSteps[0]!;
            const firstOpts = first.options.map((o) => String(o ?? "").trim()).filter(Boolean);
            const bodyOnly = [afterExperience].filter((x) => x.length > 0).join("\n\n").trim();
            const menuFooter = salesFlowMenuFooter(knowledge);
            const cas = await tryAdvanceWarmupAwaitingIdx({
              supabase,
              businessId,
              phone: msg.from,
              requireReadIdx: -1,
              nextIdx: 0,
            });
            if (!cas.advanced) return;

            try {
              await sendWarmupReplyThenNextQuestionMenu({
                msg,
                accountSid,
                authToken,
                business_slug,
                sessionId,
                replyText: bodyOnly,
                nextQuestion: first.question,
                nextOptionLabels: firstOpts,
                menuFooter,
                contentLang: resolveBusinessContentLanguageFromKnowledge(knowledge),
                replyModelUsed: "sales_flow_after_experience",
                sendErrorLabel: "Send warmup-extra first step",
                rethrowOnFailure: true,
              });
            } catch (e) {
              await rollbackWarmupAwaitingAfterSendFailure({
                supabase,
                businessId,
                phone: msg.from,
                readIdx: cas.readIdx,
                nextIdx: cas.nextIdx,
                context: "warmup_q1_answer_to_extra",
                sendError: e,
              });
              return;
            }
            try {
              await logMessage({
                business_slug,
                role: "event",
                content: `${HEYZOE_SF_WARMUP_EXTRA_PREFIX}0`,
                model_used: "sf_warmup_extra",
                session_id: sessionId,
              });
            } catch (e) {
              console.error(
                "[WA Webhook] warmup Q1→extra event log failed (send succeeded; no CAS rollback):",
                e
              );
            }
            return;
          }

          const bodyOnly = [afterExperience].filter((x) => x.length > 0).join("\n\n").trim();
          const out = bodyOnly;

          await sendWhatsAppMessage(msg.toNumber, msg.from, out, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send after-experience reply failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: out,
            model_used: "sales_flow_after_experience",
            session_id: sessionId,
          });

          if (businessId) {
            await advanceAfterWarmupSessionComplete({
              knowledge,
              salesFlowServices,
              msg,
              accountSid,
              authToken,
              supabase,
              businessId,
              business_slug,
              sessionId,
              blockTrialPickMedia: starterBlocksMedia,
              trialRegistered: contactTrialRegistered,
              allowTrialCta: allowTrialCtaThisSession,
              sfConsumedKinds: sfClickedCtaKinds,
              instagramFollowPromptSent: contactInstagramFollowPromptSent,
            });
            contactSessionPhase =
              salesFlowServices.length > 1
                ? "opening"
                : scheduleSelectionPhaseAfterService(knowledge, salesFlowServices[0] ?? null);
            contactFlowStep = 0;
          }
          return;
        }
      }
    } catch (e) {
      console.warn("[WA Webhook] Sales-flow experience→CTA failed (continuing):", e);
    }
  }

  // 4) FAQ exact-ish match (dashboard data)
  if (msg.type === "text" && businessId) {
    try {
      const { data: faqs } = await supabase
        .from("faqs")
        .select("question, answer")
        .eq("business_id", Number(businessId))
        .order("sort_order", { ascending: true })
        .limit(40);

      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const inTxt = norm(msg.text);
      const hit = (faqs ?? []).find((f: { question?: unknown }) => {
        const q = norm(String(f.question ?? ""));
        if (!q) return false;
        if (inTxt === q) return true;
        if (q.length >= 6 && inTxt.includes(q)) return true;
        if (inTxt.length >= 8 && q.includes(inTxt)) return true;
        return false;
      });

      const ans = hit ? String((hit as { answer?: unknown }).answer ?? "").trim() : "";
      if (ans) {
        await sendWhatsAppMessage(msg.toNumber, msg.from, ans, accountSid, authToken).catch((e) =>
          console.error("[WA Webhook] Send FAQ reply failed:", e)
        );
        await logMessage({
          business_slug,
          role: "assistant",
          content: ans,
          model_used: "faq",
          session_id: sessionId,
        });
        return;
      }
    } catch (e) {
      console.warn("[WA Webhook] FAQ lookup failed (continuing):", e);
    }
  }

  // ── Quick-reply vs. "other question" routing ────────────────────────────────
  const quickLabels = (knowledge?.quickReplies ?? [])
    .map((qr) => qr.label.trim())
    .filter((lbl) => lbl.length > 0);
  const sfCfgForAi = knowledge?.salesFlowConfig ?? null;
  const sfAiEff: EffectiveSalesFlowCtaInput | null =
    sfCfgForAi != null
      ? {
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
          consumedNonTrialKinds: new Set(sfClickedCtaKinds),
        }
      : null;
  let sfAiSelected: (typeof salesFlowServices)[number] | null =
    salesFlowServices.length === 1 ? salesFlowServices[0]! : null;
  if (!sfAiSelected && salesFlowServices.length > 1) {
    const pick = await fetchLastSfServiceEventName({ business_slug, session_id: sessionId });
    sfAiSelected = salesFlowServices.find((s) => s.name === pick) ?? salesFlowServices[0] ?? null;
  }
  const sfAiOfferKind = sfAiSelected?.offerKind ?? "trial";
  const filteredCtaForAi =
    sfCfgForAi != null && sfAiEff != null
      ? sfAiOfferKind === "trial"
        ? getEffectiveSalesFlowCtaButtons(sfCfgForAi.cta_buttons, sfAiEff)
        : getEffectiveSecondaryOfferCtaButtons(
            ctaButtonsForOfferKind(sfCfgForAi, sfAiOfferKind),
            sfClickedCtaKinds
          )
      : [];
  const effectiveFollowLabelsForPred =
    sfCfgForAi != null && sfAiEff != null
      ? getEffectiveFollowupMenuLabels(sfCfgForAi.followup_after_next_class_options, sfAiEff, sfCfgForAi.cta_buttons)
      : [];
  const ctaMenuLabelsForAi =
    contactSessionPhase === "cta"
      ? filteredCtaForAi.map((b) => b.label.trim()).filter((l) => l.length > 0)
      : [];
  const buttons: string[] = [
    ...quickLabels,
    ...ctaMenuLabelsForAi.filter((l) => !quickLabels.some((q) => q === l)),
  ];

  const incomingRaw =
    msg.type === "text" && msg.metaInteractiveReplyId
      ? resolveMetaInteractiveLabel(msg.metaInteractiveReplyId, msg.text, buttons)
      : msg.type === "text"
        ? msg.text.trim()
        : "";
  const incomingNorm = incomingRaw.toLowerCase();

  // Allow numeric answers (1/2/3...) to map to the displayed buttons list.
  let incomingAsLabel = incomingRaw;
  const asNum = Number(incomingNorm);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= buttons.length) {
    incomingAsLabel = buttons[asNum - 1] ?? incomingRaw;
  }

  const matched = knowledge?.quickReplies?.find(
    (qr) => qr.label.trim().toLowerCase() === incomingAsLabel.trim().toLowerCase()
  );
  const predefinedClosedLabels = [
    ...quickLabels,
    ...(knowledge?.salesFlowConfig?.greeting_extra_steps ?? []).flatMap((step) => step.options.map((option) => option.trim())),
    ...salesFlowServices.map((service) => service.name.trim()),
    ...((knowledge?.salesFlowConfig?.experience_options ?? []).map((option) => String(option ?? "").trim())),
    ...((knowledge?.salesFlowConfig?.experience_options_workshop ?? []).map((option) =>
      String(option ?? "").trim()
    )),
    ...((knowledge?.salesFlowConfig?.experience_options_course ?? []).map((option) =>
      String(option ?? "").trim()
    )),
    ...filteredCtaForAi.map((b) => b.label.trim()),
    ...effectiveFollowLabelsForPred.map((option) => String(option ?? "").trim()),
  ].filter(Boolean);
  const skipPredefinedForWarmupMenuReply =
    isMetaInteractiveMenuReply(msg) &&
    (contactSessionPhase === "warmup" || isWarmupExtraMenuModel(await fetchLastAssistantModelUsed({ business_slug, session_id: sessionId })));
  const matchedPredefinedClosedLabel =
    !skipPredefinedForWarmupMenuReply &&
    !matched?.reply &&
    predefinedClosedLabels.find((label) => waLabelMatches(incomingAsLabel, label));
  const lastPickedServiceName =
    msg.type === "text" && knowledge?.salesFlowConfig && salesFlowServices.length > 1
      ? await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })
      : null;
  const shouldReaskServiceSelection =
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    salesFlowServices.length > 1 &&
    !lastPickedServiceName &&
    !matched?.reply &&
    !matchedPredefinedClosedLabel;
  const serviceSelectionLabels = shouldReaskServiceSelection
    ? salesFlowServices.map((service) => service.name.trim()).filter(Boolean).slice(0, 12)
    : [];
  const serviceSelectionQuestion =
    shouldReaskServiceSelection && knowledge?.salesFlowConfig?.multi_service_question?.trim()
      ? knowledge.salesFlowConfig.multi_service_question.trim()
      : "";
  // We send CTA menus deterministically; avoid appending a CTA prompt to free-text answers.
  const ctaPromptQuestion = "";

  const isSalesFlowOpenQuestionAi =
    msg.type === "text" &&
    Boolean(knowledge?.salesFlowConfig) &&
    Boolean(businessId) &&
    !matched?.reply &&
    !matchedPredefinedClosedLabel;

  const registeredInCurrentFlow =
    contactTrialRegistered === true || contactSessionPhase === "registered";

  const isFreeTextSalesFlowAi =
    isSalesFlowOpenQuestionAi && !registeredInCurrentFlow;

  const isJoinSignupIntent = msg.type === "text" && isJoinSignupIntentText(incomingRaw);

  const isWarmupSkipIntent =
    msg.type === "text" &&
    !registeredInCurrentFlow &&
    (contactSessionPhase === "opening" || contactSessionPhase === "warmup") &&
    isWarmupSkipIntentText(incomingRaw, contactSessionPhase);

  const joinSignupRecovery: JoinSignupRecoveryAction =
    matched || matchedPredefinedClosedLabel
      ? "none"
      : await resolveJoinSignupRecoveryAction({
          business_slug,
          session_id: sessionId,
          phase: contactSessionPhase,
          isJoinSignupIntent,
          isFreeTextSalesFlowAi,
          multiService: salesFlowServices.length > 1,
          lastPickedServiceName,
        });

  let replyCore: string;
  let replyErrorCode: string | null = null;
  let isFallbackErrorReply = false;
  let didCallClaude = false;
  let replyModelUsed: string = CLAUDE_WHATSAPP_MODEL;
  let pickedServiceScheduleLexicon: string | undefined;
  let pickedServiceScheduleDayLabels: string[] | undefined;
  if (isSalesFlowOpenQuestionAi) {
    const pickedNameForLexicon =
      (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId }))?.trim() ?? "";
    if (pickedNameForLexicon) {
      const pickedRow =
        salesFlowServices.find((s) => s.name === pickedNameForLexicon) ?? null;
      if (pickedRow) {
        pickedServiceScheduleLexicon = buildPickedServiceScheduleLexiconForPrompt({
          serviceName: pickedRow.name,
          scheduleSlots: pickedRow.scheduleSlots,
          courseCycles: pickedRow.courseCycles,
        });
        if (pickedServiceScheduleLexicon) {
          pickedServiceScheduleDayLabels = getScheduleDayLabelsFromSlots(pickedRow.scheduleSlots);
          for (const cycle of pickedRow.courseCycles ?? []) {
            for (const label of getScheduleDayLabelsFromSlots(cycle.schedule_slots ?? [])) {
              if (!pickedServiceScheduleDayLabels.includes(label)) {
                pickedServiceScheduleDayLabels.push(label);
              }
            }
          }
        }
      }
    }
  }

  if (matched && matched.reply) {
    // Static answer for a predefined quick-reply button
    replyCore = matched.reply;
    console.info(`[WA Webhook] Quick-reply match: "${matched.label}" → static response`);
  } else if (matchedPredefinedClosedLabel) {
    await recoverUnrecognizedMenuPick({
      knowledge,
      salesFlowServices,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      contactSessionPhase,
      contactFlowStep,
      contactTrialRegistered,
      allowTrialCtaThisSession,
      sfClickedCtaKinds,
      contactInstagramFollowPromptSent,
      blockTrialPickMedia: starterBlocksMedia,
      sendOpeningMediaIfConfigured,
      logModelUsed: "predefined_choice_guard",
    });
    return;
  } else if (isWarmupSkipIntent && knowledge?.salesFlowConfig && businessId) {
    await advanceAfterWarmupSessionComplete({
      knowledge,
      salesFlowServices,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      blockTrialPickMedia: starterBlocksMedia,
      trialRegistered: contactTrialRegistered,
      allowTrialCta: allowTrialCtaThisSession,
      sfConsumedKinds: sfClickedCtaKinds,
      instagramFollowPromptSent: contactInstagramFollowPromptSent,
    });
    return;
  } else if (joinSignupRecovery === "service_pick" && knowledge?.salesFlowConfig && businessId) {
    const phoneVariants = contactPhoneLookupVariants(msg.from);
    await supabase
      .from("contacts")
      .update(salesFlowOpeningResetPatch())
      .eq("business_id", businessId)
      .in("phone", phoneVariants.length ? phoneVariants : [msg.from]);
    contactSessionPhase = "opening";
    contactFlowStep = 0;
    await sendOpeningServicePickMenu({
      knowledge,
      salesFlowServices,
      msg,
      accountSid,
      authToken,
      business_slug,
      sessionId,
      blockMedia: starterBlocksMedia,
      skipScheduleBoard: true,
    });
    return;
  } else if (
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    businessId &&
    salesFlowServices.length > 1 &&
    !matched?.reply &&
    !matchedPredefinedClosedLabel &&
    (await shouldHandleCtaServiceRepickYes({
      phase: contactSessionPhase,
      multiService: true,
      lastPickedServiceName,
      scheduleDate: contactScheduleRequestedDate,
      scheduleTime: contactScheduleRequestedTime,
      inboundText: incomingRaw,
      business_slug,
      session_id: sessionId,
    }))
  ) {
    const phoneVariants = contactPhoneLookupVariants(msg.from);
    await supabase
      .from("contacts")
      .update(salesFlowOpeningResetPatch())
      .eq("business_id", businessId)
      .in("phone", phoneVariants.length ? phoneVariants : [msg.from]);
    contactSessionPhase = "opening";
    contactFlowStep = 0;
    contactScheduleRequestedDate = "";
    contactScheduleRequestedTime = "";
    await sendOpeningServicePickMenu({
      knowledge,
      salesFlowServices,
      msg,
      accountSid,
      authToken,
      business_slug,
      sessionId,
      blockMedia: starterBlocksMedia,
      skipScheduleBoard: true,
      modelUsed: "sales_flow_cta_repick_service_menu",
    });
    return;
  } else if (joinSignupRecovery === "cta_menu" && knowledge?.salesFlowConfig && businessId) {
    // רק אחרי נפילה ל-AI חופשי בסשן CTA, ובלי תפריט CTA שכבר נשלח בהודעה הקודמת.
    await sendSalesFlowCtaMenuWithPhaseUpdate({
      knowledge,
      msg,
      accountSid,
      authToken,
      supabase,
      businessId,
      business_slug,
      sessionId,
      salesFlowServices,
      trialRegistered: contactTrialRegistered,
      allowTrialCta: allowTrialCtaThisSession,
      sfConsumedKinds: sfClickedCtaKinds,
      modelUsed: "sf_recover_to_cta",
    });
    contactSessionPhase = "cta";
    contactFlowStep = 0;
    return;
  } else if (
    msg.type === "text" &&
    knowledge?.salesFlowConfig &&
    businessId &&
    !matched?.reply &&
    !matchedPredefinedClosedLabel &&
    (await trySendSalesFlowHumanAgentHandoff({
      inboundText: incomingRaw,
      knowledge,
      msg,
      accountSid,
      authToken,
      business_slug,
      sessionId,
    }))
  ) {
    return;
  } else {
    // Rate-limit: 20 AI answers in a rolling 24h window (prevents token abuse without blocking forever).
    // Count only model-generated assistant replies (Claude/Gemini) for this WhatsApp session_id.
    try {
      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true } as any)
        .eq("business_slug", business_slug)
        .eq("session_id", sessionId)
        .eq("role", "assistant")
        .in("model_used", [CLAUDE_WHATSAPP_MODEL, GEMINI_WHATSAPP_MODEL])
        .gte("created_at", sinceIso);
      const recentAiCount = typeof count === "number" ? count : 0;
      if (recentAiCount >= 20) {
        const phone = knowledge?.customerServicePhone?.trim() ?? "";
        const txt = phone
          ? [
              "כדי לשמור על איכות המענה, הגענו למגבלת תשובות אוטומטיות ב־24 שעות האחרונות.",
              "נשמח לעזור ישירות דרך שירות הלקוחות:",
              `טלפון שירות לקוחות: ${phone}`,
            ].join("\n")
          : [
              "כדי לשמור על איכות המענה, הגענו למגבלת תשובות אוטומטיות ב־24 שעות האחרונות.",
              "מומלץ לדבר ישירות עם הצוות שלנו. נשמח לחזור אליך בהקדם!",
            ].join("\n");
        if (knowledge && businessId && phone) {
          await sendCustomerServiceRedirectWithServicePickFollowUp({
            csMessage: txt,
            modelUsed: "claude_limit_24h",
            knowledge,
            salesFlowServices,
            msg,
            accountSid,
            authToken,
            supabase,
            businessId,
            business_slug,
            sessionId,
          });
        } else {
          await sendWhatsAppMessage(msg.toNumber, msg.from, txt, accountSid, authToken).catch((e) =>
            console.error("[WA Webhook] Send AI-24h-limit reply failed:", e)
          );
          await logMessage({
            business_slug,
            role: "assistant",
            content: txt,
            model_used: "claude_limit_24h",
            session_id: sessionId,
            error_code: "claude_limit_24h",
          });
        }
        return;
      }
    } catch (e) {
      console.warn("[WA Webhook] 24h AI rate-limit check failed (continuing):", e);
    }

    // Fallback זיהוי (לא isFreeTextSalesFlowAi): ניסיון להמשיך פלואו דטרמיניסטי לפני Claude
    if (!isFreeTextSalesFlowAi && knowledge?.salesFlowConfig && businessId) {
      const recovered = await tryRecoverDeterministicSalesFlowOnRecognitionMiss({
        phase: contactSessionPhase,
        flowStep: contactFlowStep,
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        blockTrialPickMedia: starterBlocksMedia,
        trialRegistered: contactTrialRegistered,
        allowTrialCta: allowTrialCtaThisSession,
        sfConsumedKinds: sfClickedCtaKinds,
        instagramFollowPromptSent: contactInstagramFollowPromptSent,
        scheduleRequestedDate: contactScheduleRequestedDate,
        scheduleRequestedTime: contactScheduleRequestedTime,
      });
      if (recovered) {
        console.info("[WA Webhook] Deterministic flow recovered (skipped Claude)", {
          business_slug,
          session_id: sessionId,
          phase: contactSessionPhase,
          flow_step: contactFlowStep,
        });
        return;
      }
    }

    if (msg.type === "text" && isMetaInteractiveMenuReply(msg)) {
      if (
        knowledge?.salesFlowConfig &&
        knowledge.warmupSessionEnabled !== false &&
        businessId &&
        contactSessionPhase === "warmup"
      ) {
        const warmPickLeak = await attemptWarmupExtraMenuPick({
          knowledge,
          salesFlowServices,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          contactSessionPhase,
          contactFlowStep,
          contactTrialRegistered,
          allowTrialCtaThisSession,
          sfClickedCtaKinds,
          contactInstagramFollowPromptSent,
          blockTrialPickMedia: starterBlocksMedia,
          debugTag: "leak-guard-warmup-retry",
        });
        if (warmPickLeak.handled) {
          console.info("[WA Webhook] interactive leak guard avoided — warmup pick handled", {
            business_slug,
            session_id: sessionId,
          });
          return;
        }
      }
      warnInteractiveReplyRoutedToClaude({
        business_slug,
        sessionId,
        msg,
        sessionPhase: contactSessionPhase,
        isFreeTextSalesFlowAi,
      });
      await recoverUnrecognizedMenuPick({
        knowledge,
        salesFlowServices,
        msg,
        accountSid,
        authToken,
        supabase,
        businessId,
        business_slug,
        sessionId,
        contactSessionPhase,
        contactFlowStep,
        contactTrialRegistered,
        allowTrialCtaThisSession,
        sfClickedCtaKinds,
        contactInstagramFollowPromptSent,
        blockTrialPickMedia: starterBlocksMedia,
        sendOpeningMediaIfConfigured,
        logModelUsed: "interactive_reply_claude_leak_guard",
      });
      return;
    }

    if (
      isFreeTextSalesFlowAi &&
      knowledge?.salesFlowConfig &&
      businessId &&
      (contactSessionPhase === "opening" || contactSessionPhase === "registered")
    ) {
      const wantsFlowStart = await classifySalesFlowStartIntentWithClaude({
        apiKey: claudeApiKey,
        text: msg.text,
      });
      if (wantsFlowStart) {
        const restartState = await restartSalesFlowFromGreeting({
          knowledge,
          salesFlowServices,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          blockTrialPickMedia: starterBlocksMedia,
          sendOpeningMediaIfConfigured,
          logModelUsed: "greeting",
        });
        if (restartState.ranContinuation) {
          console.info("[WA Webhook] Sales-flow start intent → greeting restart", {
            business_slug,
            session_id: sessionId,
            prior_phase: contactSessionPhase,
          });
          allowTrialCtaThisSession = restartState.allowTrialCtaThisSession;
          contactSessionPhase = restartState.contactSessionPhase;
          contactFlowStep = restartState.contactFlowStep;
          sfClickedCtaKinds = restartState.sfClickedCtaKinds;
          contactInstagramFollowPromptSent = restartState.contactInstagramFollowPromptSent;
          contactTrialRegistered = restartState.contactTrialRegistered;
          contactTrialRegisteredAt = restartState.contactTrialRegisteredAt;
        }
        return;
      }
    }

    // Any free-form question → Claude/Gemini (עם היסטוריית סשן כדי להמשיך פלואו מכירה)
    const platformGuidelines = await loadZoePlatformGuidelines();
    let pendingWarmupExperienceResume = false;
    if (isFreeTextSalesFlowAi && contactSessionPhase === "warmup" && knowledge?.salesFlowConfig) {
      pendingWarmupExperienceResume = await isWarmupExperienceQuestionPending({
        admin: supabase,
        business_slug,
        session_id: sessionId,
      });
    }
    let committedServiceName: string | undefined;
    let scheduleInterestServiceName: string | undefined;
    const pickedForPrompt = (await fetchLastSfServiceEventName({ business_slug, session_id: sessionId })) ?? "";
    if (
      contactSessionPhase === "cta" &&
      (contactScheduleRequestedDate || contactScheduleRequestedTime)
    ) {
      if (pickedForPrompt.trim()) committedServiceName = pickedForPrompt.trim();
    }
    if (
      (contactSessionPhase === "schedule_date" || contactSessionPhase === "schedule_time") &&
      pickedForPrompt.trim()
    ) {
      scheduleInterestServiceName = pickedForPrompt.trim();
    }
    const currentText = msg.text.trim();
    const systemPrompt = buildSystemPrompt(
      knowledge,
      business_slug,
      "whatsapp",
      {
        sessionPhase: contactSessionPhase,
        trialRegistered: contactTrialRegistered === true,
        suppressFollowUpQuestion: isSalesFlowOpenQuestionAi && !registeredInCurrentFlow,
        registeredOpenQuestionHelpClosing: isSalesFlowOpenQuestionAi && registeredInCurrentFlow,
        pendingWarmupExperienceResume,
        committedServiceName,
        committedScheduleDate: contactScheduleRequestedDate || undefined,
        committedScheduleTime: contactScheduleRequestedTime || undefined,
        ctaMultiServiceRepick: salesFlowServices.length > 1,
        scheduleInterestServiceName,
        pickedServiceScheduleLexicon,
      },
      platformGuidelines,
      currentText
    );
    const history = await fetchRecentSessionMessages({
      business_slug,
      session_id: sessionId,
      limit: 10,
    });
    const claudeMessages =
      history.length > 0
        ? history.map((m) => ({ role: m.role, content: m.content }))
        : [];
    const lastHistoryMessage = claudeMessages[claudeMessages.length - 1];
    if (
      currentText &&
      (!lastHistoryMessage ||
        lastHistoryMessage.role !== "user" ||
        String(lastHistoryMessage.content ?? "").trim() !== currentText)
    ) {
      claudeMessages.push({ role: "user" as const, content: currentText });
    }
    const client = new Anthropic({ apiKey: claudeApiKey });
    try {
      didCallClaude = true;
      const runClaude = async () =>
        client.messages.create({
          model: CLAUDE_WHATSAPP_MODEL,
          max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
          system: systemPrompt,
          messages: claudeMessages,
        });
      const runGemini = async () => {
        const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? "";
        if (!geminiApiKey) throw new Error("Missing GEMINI_API_KEY");
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({
          model: GEMINI_WHATSAPP_MODEL,
          systemInstruction: systemPrompt,
        });
        const response = await model.generateContent({
          contents: claudeMessages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: String(m.content ?? "") }],
          })),
        });
        const text = response.response.text().trim();
        if (!text) throw new Error("empty response");
        return text;
      };

      try {
        let response: Awaited<ReturnType<typeof runClaude>> | null = null;
        try {
          response = await runClaude();
        } catch (e) {
          // One quick retry on transient errors (Twilio webhook must stay fast)
          if (isRetryableClaudeError(e)) {
            await sleepMs(900);
            response = await runClaude();
          } else {
            throw e;
          }
        }

        const extractCombinedText = (resObj: any) => {
          const textBlocks =
            Array.isArray(resObj?.content)
              ? resObj.content
                  .filter(
                    (b: any) =>
                      b && typeof b === "object" && b.type === "text" && typeof b.text === "string"
                  )
                  .map((b: any) => String(b.text).trim())
                  .filter(Boolean)
              : [];
          return textBlocks.join("\n").trim();
        };

        // Some rare Anthropic responses return end_turn with empty content.
        // Retry once even if no error was thrown.
        let combinedText = extractCombinedText(response as any);
        if (!combinedText) {
          await sleepMs(700);
          const retryResp = await runClaude();
          combinedText = extractCombinedText(retryResp as any);
          response = retryResp;
        }

        if (!combinedText) {
          const types =
            Array.isArray((response as any)?.content)
              ? (response as any).content.map((b: any) => String(b?.type ?? "unknown")).join(",")
              : "no_content";
          const stopReason = String((response as any)?.stop_reason ?? "");
          const model = String((response as any)?.model ?? "");
          const id = String((response as any)?.id ?? "");
          console.warn("[WA Webhook] Claude empty_response", { id, model, stopReason, types });
          replyErrorCode = replyErrorCode ?? "empty_response";
          throw new Error("Claude empty response");
        }

        replyCore = combinedText;
      } catch (claudeError) {
        console.error(`[WA Webhook] Claude error for ${business_slug}, falling back to Gemini:`, claudeError);
        try {
          replyCore = await runGemini();
          replyModelUsed = GEMINI_WHATSAPP_MODEL;
        } catch (geminiError) {
          console.error(`[WA Webhook] Gemini fallback error for ${business_slug}:`, geminiError);
          replyCore = formatUserFacingClaudeError(geminiError);
          replyErrorCode = extractErrorCode(geminiError);
          isFallbackErrorReply = true;
          replyErrorCode = replyErrorCode ?? "claude_failed";
        }
      }
    } catch (e) {
      console.error(`[WA Webhook] Claude/Gemini setup error for ${business_slug}:`, e);
      replyCore = formatUserFacingClaudeError(e);
      replyErrorCode = extractErrorCode(e);
      isFallbackErrorReply = true;
      replyErrorCode = replyErrorCode ?? "claude_failed";
    }
  }

  const needsCtaRepickBridge =
    !isFallbackErrorReply &&
    isFreeTextSalesFlowAi &&
    contactSessionPhase === "cta" &&
    salesFlowServices.length > 1 &&
    Boolean(lastPickedServiceName?.trim()) &&
    Boolean(contactScheduleRequestedDate || contactScheduleRequestedTime) &&
    isCtaServiceFitQuestion(incomingRaw) &&
    !isExplicitOtherServiceRequest(incomingRaw);

  const menuFooter = salesFlowMenuFooter(knowledge);
  const aiMenuContentLang = resolveBusinessContentLanguageFromKnowledge(knowledge);
  const stripCandidates = [
    ...serviceSelectionLabels,
    ...buttons,
    ...quickLabels,
    ...(contactSessionPhase === "cta" ? ctaMenuLabelsForAi : []),
  ].filter(Boolean);

  const shouldStripModelNumberedChoices =
    !isFallbackErrorReply && (contactTrialRegistered === true || stripCandidates.length > 0);
  const replyCoreForMenu = shouldStripModelNumberedChoices
    ? stripNumberedChoiceLinesAnywhere(stripTrailingNumberedChoiceLines(replyCore), stripCandidates)
    : replyCore;
  const replyCoreClean = applyKnownAssistantReplyFixes(
    stripAssistantInteractiveButtonsLog(stripZoeMenuFooterFromText(replyCoreForMenu)),
    {
      knowledge,
      phase: contactSessionPhase,
      multiServiceAwaitingPick:
        salesFlowServices.length > 1 && !(lastPickedServiceName ?? "").trim(),
      scheduleSlotsWithPickedService:
        (contactSessionPhase === "schedule_date" || contactSessionPhase === "schedule_time") &&
        Boolean((lastPickedServiceName ?? "").trim()),
      selectedServiceName: lastPickedServiceName ?? "",
      scheduleDayLabels: pickedServiceScheduleDayLabels,
    }
  );

  if (
    !isFallbackErrorReply &&
    businessId &&
    assistantReplyIndicatesLeadNotRelevant(replyCoreClean)
  ) {
    const fullName =
      typeof (msg as { profileName?: string }).profileName === "string"
        ? (msg as { profileName?: string }).profileName!.trim()
        : "";
    await handleLeadNotRelevant({
      supabase,
      businessId: Number(businessId),
      businessSlug: business_slug,
      phone: msg.from,
      text: incomingTextRaw,
      nowIso,
      waFromNumber: msg.toNumber,
      accountSid,
      authToken,
      sessionId: sessionId,
      fullName: fullName || null,
    });
    return;
  }

  function softenWebsiteAttribution(text: string): string {
    // Keep replies sounding like the business, not "the website".
    // Only touch common short patterns; avoid broad replacements.
    let t = String(text ?? "");
    t = t.replace(/(\bיש)\s+([^.\n]{1,80})\s+באתר\b/gu, "יש לנו $2");
    t = t.replace(/(\bכן),?\s+([^.\n]{1,80})\s+באתר\b/gu, "כן, יש לנו $2");
    t = t.replace(/\b(לפי האתר|מהאתר|באתר שלנו)\b/gu, "אצלנו");
    t = t.replace(
      /האם יש עוד משהו שאני יכולה לעזור לך עם\?/gu,
      "האם יש עוד משהו שאני יכולה לעזור לך איתו?"
    );
    return t;
  }

  function normalizeLine(s: string): string {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function hasLineNearEnd(text: string, needle: string, lookbackLines = 6): boolean {
    const n = normalizeLine(needle);
    if (!n) return false;
    const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => normalizeLine(l)).filter(Boolean);
    const tail = lines.slice(Math.max(0, lines.length - lookbackLines));
    return tail.includes(n);
  }

  function dedupeConsecutiveDuplicateLines(text: string): string {
    const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    for (const line of lines) {
      const prev = out.length ? out[out.length - 1]! : null;
      if (prev != null && normalizeLine(prev) && normalizeLine(prev) === normalizeLine(line)) continue;
      out.push(line);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function stripSalesFlowCtaHookFromAnswer(text: string): string {
    // In CTA phase, when we split into (answer) + (CTA menu), we must keep the first message
    // as a pure answer without a sales hook line like "מה דעתך להגיע לאימון ניסיון בקרוב...".
    const raw = String(text ?? "").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    const isCtaHookLine = (line: string) => {
      const n = normalizeLine(line);
      if (!n) return false;
      if (n.startsWith("מה דעתך? שנשריין אימון ניסיון")) return true;
      // Common CTA hook variants from the sales-flow templates / model completions
      return /מה דעתך.*אימון.*ניסיון/u.test(n);
    };
    const filtered = lines.filter((l) => !isCtaHookLine(l));
    return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  let replyText = replyCoreClean;
  replyText = softenWebsiteAttribution(replyText);
  let assistantReplyLogged = false;

  // If Claude failed and we sent a generic error, don't append menus/CTAs (keeps message clean).
  if (!isFallbackErrorReply) {
    const shouldSplitCtaAnswerAndMenu =
      !shouldReaskServiceSelection &&
      contactSessionPhase === "cta" &&
      !matched?.reply &&
      !matchedPredefinedClosedLabel;
    const menuLabels = shouldReaskServiceSelection ? serviceSelectionLabels : buttons;
    const menuQuestion = shouldReaskServiceSelection ? serviceSelectionQuestion : ctaPromptQuestion;
    const shouldShowFooter = Boolean(menuQuestion) || menuLabels.length > 0;
    if (!shouldSplitCtaAnswerAndMenu && menuQuestion && !hasLineNearEnd(replyText, menuQuestion)) {
      replyText += `\n\n${menuQuestion}`;
    }

    const ctaText =
      !shouldSplitCtaAnswerAndMenu &&
      !shouldReaskServiceSelection &&
      contactSessionPhase === "cta" &&
      contactTrialRegistered !== true
        ? knowledge?.ctaText?.trim()
        : "";
    const ctaLink =
      !shouldSplitCtaAnswerAndMenu &&
      !shouldReaskServiceSelection &&
      contactSessionPhase === "cta" &&
      contactTrialRegistered !== true
        ? knowledge?.ctaLink?.trim()
        : "";
    if (ctaText && ctaLink) {
      replyText += `\n\n${ctaText}: ${ctaLink}`;
    }

    if (!shouldSplitCtaAnswerAndMenu && shouldShowFooter) replyText += `\n\n${menuFooter}`;
    replyText = dedupeConsecutiveDuplicateLines(replyText);
  }

  try {
    if (isFallbackErrorReply) {
      await sendWhatsAppMessage(msg.toNumber, msg.from, replyCore, accountSid, authToken);
    } else {
      const shouldSplitCtaAnswerAndMenu =
        !shouldReaskServiceSelection &&
        contactSessionPhase === "cta" &&
        !matched?.reply &&
        !matchedPredefinedClosedLabel;

      const menuLabels = shouldReaskServiceSelection ? serviceSelectionLabels : buttons;
      const menuQuestion = shouldReaskServiceSelection ? serviceSelectionQuestion : ctaPromptQuestion;
      const ctaText =
        !shouldSplitCtaAnswerAndMenu &&
        !shouldReaskServiceSelection &&
        contactSessionPhase === "cta" &&
        contactTrialRegistered !== true
          ? knowledge?.ctaText?.trim()
          : "";
      const ctaLink =
        !shouldSplitCtaAnswerAndMenu &&
        !shouldReaskServiceSelection &&
        contactSessionPhase === "cta" &&
        contactTrialRegistered !== true
          ? knowledge?.ctaLink?.trim()
          : "";

      const isFreeTextSalesFlowContinuation = isFreeTextSalesFlowAi && !isFallbackErrorReply;

      let openingSkipFlowContinuation = false;
      if (contactSessionPhase === "opening") {
        if (isExplicitOtherServiceRequest(incomingRaw)) {
          openingSkipFlowContinuation = true;
        } else {
          const [lastModel, lastContent] = await Promise.all([
            fetchLastAssistantModelUsed({ business_slug, session_id: sessionId }),
            fetchLastAssistantMessageContent({ business_slug, session_id: sessionId }),
          ]);
          openingSkipFlowContinuation =
            lastModel === "sales_flow_cta_repick_service_menu" ||
            replyContainsServiceRepickBridge(lastContent);
        }
      }
      const shouldSplitFreeTextAnswerAndResendPrompt =
        isFreeTextSalesFlowContinuation &&
        SALES_FLOW_FREE_TEXT_SPLIT_PHASES.has(contactSessionPhase) &&
        !openingSkipFlowContinuation;

      const csPhoneForRedirect = knowledge?.customerServicePhone?.trim() ?? "";
      const shouldOfferServicePickAfterCs =
        Boolean(businessId) &&
        Boolean(knowledge?.salesFlowConfig) &&
        salesFlowServices.length > 1 &&
        replyRefersToCustomerService(replyCoreClean, csPhoneForRedirect);

      if (shouldOfferServicePickAfterCs && knowledge && businessId) {
        await sendCustomerServiceRedirectWithServicePickFollowUp({
          csMessage: stripTrailingFollowUpQuestion(
            softenWebsiteAttribution(dedupeConsecutiveDuplicateLines(replyCoreClean))
          ),
          modelUsed: replyModelUsed,
          knowledge,
          salesFlowServices,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
        });
        assistantReplyLogged = true;
        contactSessionPhase = "opening";
        contactFlowStep = 0;
      } else if (shouldSplitCtaAnswerAndMenu) {
        // CTA phase + free-text question:
        // 1) answer only (no CTA, no buttons, no footer)
        // 2) send the CTA menu in a separate message
        let answerOnly = stripTrailingFollowUpQuestion(
          stripSalesFlowCtaHookFromAnswer(
            softenWebsiteAttribution(dedupeConsecutiveDuplicateLines(replyCoreClean))
          )
        );
        if (needsCtaRepickBridge) {
          answerOnly = ensureCtaServiceRepickBridge(answerOnly);
        }
        await sendWhatsAppMessage(msg.toNumber, msg.from, answerOnly, accountSid, authToken);
        await logMessage({
          business_slug,
          role: "assistant",
          content: answerOnly,
          model_used: replyModelUsed,
          session_id: sessionId,
          error_code: replyErrorCode,
        });
        assistantReplyLogged = true;
        if (businessId && knowledge?.salesFlowConfig && !needsCtaRepickBridge) {
          await sendSalesFlowCtaMenuWithPhaseUpdate({
            knowledge,
            msg,
            accountSid,
            authToken,
            supabase,
            businessId,
            business_slug,
            sessionId,
            salesFlowServices,
            trialRegistered: contactTrialRegistered,
            allowTrialCta: allowTrialCtaThisSession,
            sfConsumedKinds: sfClickedCtaKinds,
            modelUsed: "sales_flow_cta",
          });
        }
      } else if (shouldSplitFreeTextAnswerAndResendPrompt) {
        // opening / warmup / schedule + free-text question:
        // 1) answer only
        // 2) continue the deterministic flow in a separate message (question + WhatsApp buttons)
        const menuLabels = shouldReaskServiceSelection ? serviceSelectionLabels : buttons;
        const menuQuestion = shouldReaskServiceSelection ? serviceSelectionQuestion : ctaPromptQuestion;
        let answerBody = softenWebsiteAttribution(dedupeConsecutiveDuplicateLines(replyCoreClean));
        if (knowledge?.salesFlowConfig) {
          const pendingWarmup = await isWarmupExperienceQuestionPending({
            admin: supabase,
            business_slug,
            session_id: sessionId,
          });
          if (pendingWarmup) {
            const warmupMenu = await buildWarmupExperienceMenu({
              cfg: knowledge.salesFlowConfig,
              salesFlowServices,
              fetchLastSfServiceEventName,
              business_slug,
              session_id: sessionId,
            });
            if (warmupMenu) {
              answerBody = stripPendingWarmupMenuFromAnswer(answerBody, warmupMenu);
            }
          }
        }
        const answerOnly = stripTrailingFollowUpQuestion(
          stripMenuEchoFromAnswer(answerBody, menuQuestion, menuLabels)
        );
        await sendWhatsAppMessage(msg.toNumber, msg.from, answerOnly, accountSid, authToken);
        await logMessage({
          business_slug,
          role: "assistant",
          content: answerOnly,
          model_used: replyModelUsed,
          session_id: sessionId,
          error_code: replyErrorCode,
        });
        assistantReplyLogged = true;
        if (knowledge && businessId && !shouldOfferServicePickAfterCs) {
          await continueDeterministicFlowAfterFreeTextAi({
            phase: contactSessionPhase,
            contact: { flow_step: contactFlowStep },
            knowledge,
            msg,
            accountSid,
            authToken,
            supabase,
            businessId,
            business_slug,
            sessionId,
            salesFlowServices,
            trialRegistered: contactTrialRegistered,
            allowTrialCta: allowTrialCtaThisSession,
            blockTrialPickMedia: starterBlocksMedia,
            sfConsumedKinds: sfClickedCtaKinds,
            instagramFollowPromptSent: contactInstagramFollowPromptSent,
            inboundText: incomingRaw,
            aiReplyCoreClean: replyCoreClean,
          });
        }
      } else {
        let body = softenWebsiteAttribution(replyCoreClean);
        if (isSalesFlowOpenQuestionAi && !registeredInCurrentFlow) {
          body = stripTrailingFollowUpQuestion(body);
          if (needsCtaRepickBridge) {
            body = ensureCtaServiceRepickBridge(body);
          }
        } else if (registeredInCurrentFlow) {
          body = ensureRegisteredOpenQuestionClosing(body);
        }
        if (menuQuestion && !hasLineNearEnd(body, menuQuestion)) {
          body += `\n\n${menuQuestion}`;
        }
        if (ctaText && ctaLink) {
          body += `\n\n${ctaText}: ${ctaLink}`;
        }
        body = dedupeConsecutiveDuplicateLines(body);
        const bodyForWA = stripNumberedChoiceLinesAnywhere(body, menuLabels);
        if (/\n\s*\d+\.\s+\S/m.test(bodyForWA)) {
          console.error("[WA Webhook] INVARIANT_VIOLATION: numbered choice lines would be sent to WhatsApp", {
            business_slug,
            sessionId,
          });
        }
        await sendWhatsAppTextOrMenu(msg.toNumber, msg.from, bodyForWA, menuLabels, accountSid, authToken, {
          footerHint: menuLabels.length > 0 || Boolean(menuQuestion) ? menuFooter : "",
          language: aiMenuContentLang,
        });
      }

      // In CTA phase we already send the CTA menu explicitly as a second message (split mode),
      // so don't also schedule a flow continuation.
      if (
        isFreeTextSalesFlowContinuation &&
        !registeredInCurrentFlow &&
        knowledge &&
        businessId &&
        !shouldSplitCtaAnswerAndMenu &&
        !shouldSplitFreeTextAnswerAndResendPrompt &&
        !shouldOfferServicePickAfterCs &&
        !needsCtaRepickBridge
      ) {
        await sendFlowContinuation({
          phase: contactSessionPhase,
          contact: { flow_step: contactFlowStep },
          knowledge,
          msg,
          accountSid,
          authToken,
          supabase,
          businessId,
          business_slug,
          sessionId,
          salesFlowServices,
          trialRegistered: contactTrialRegistered,
          allowTrialCta: allowTrialCtaThisSession,
          blockTrialPickMedia: starterBlocksMedia,
          sfConsumedKinds: sfClickedCtaKinds,
          instagramFollowPromptSent: contactInstagramFollowPromptSent,
        });
      }
    }
  } catch (e) {
    console.error(`[WA Webhook] Send failed to ${msg.from}:`, e);
  }

  // Log assistant reply
  if (!assistantReplyLogged) {
    await logMessage({
      business_slug,
      role: "assistant",
      content: replyText,
      model_used: matched?.reply ? "static" : replyModelUsed,
      session_id: sessionId,
      error_code: replyErrorCode,
    });
  }

  // Increment Claude usage counter (only when Claude was called and we did not fall back).
  if (didCallClaude && businessId && !isFallbackErrorReply) {
    try {
      await supabase
        .from("contacts")
        .update({ claude_message_count: (contactClaudeCount ?? 0) + 1 })
        .eq("business_id", Number(businessId))
        .eq("phone", msg.from);
    } catch (e) {
      console.warn("[WA Webhook] claude_message_count update failed (continuing):", e);
    }
  }
  } finally {
    if (contactId != null && contactProcessingClaimedUntil) {
      await releaseContactProcessingLock(contactId, contactProcessingClaimedUntil);
    }
  }
}
