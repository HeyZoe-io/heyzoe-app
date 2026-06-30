import { HEYZOE_SF_REGISTERED, logMessage } from "@/lib/analytics";
import { salesFlowOpeningResetPatch } from "@/lib/wa-warmup-awaiting-idx";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import type { BusinessKnowledgePack } from "@/lib/business-context";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  sendWhatsAppMessage,
  sendWhatsAppTextOrMenu,
  resolveMetaAccessToken,
  isMetaCloudPhoneNumberId,
} from "@/lib/whatsapp";
import { resolveBusinessContentLanguageFromKnowledge } from "@/lib/business-content-lang";
import { getZoeWhatsAppMenuFooter } from "@/lib/whatsapp-copy";

export const CS_REDIRECT_SERVICE_PICK_BRIDGE =
  "ואם בכל זאת תרצו לשמוע על אחד מהאימונים שלנו, אני כאן בשביל זה.";

const CS_REDIRECT_PHRASE =
  /שירות\s*(ה)?לקוחות|ליצור\s*קשר|להתקשר|מוזמנים\s*להתקשר|טלפון\s*שירות|נציג|מענה\s*אנושי|דברו\s*ישירות\s*עם\s*הצוות|נשמח\s*לעזור\s*ישירות/u;

/** תשובה שהפנתה לשירות לקוחות (טלפון או ניסוח מקביל). */
export function replyRefersToCustomerService(text: string, customerServicePhone: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (CS_REDIRECT_PHRASE.test(raw)) return true;
  const phone = String(customerServicePhone ?? "").trim();
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const tail = digits.slice(-7);
  const inText = raw.replace(/\D/g, "");
  return inText.includes(tail);
}

export function replyAlreadyContainsServicePickBridge(text: string): boolean {
  const raw = String(text ?? "");
  if (raw.includes(CS_REDIRECT_SERVICE_PICK_BRIDGE)) return true;
  return /ואם בכל זאת תרצו לשמוע על אחד מהאימונים/u.test(raw);
}

export function appendCsRedirectServicePickBridge(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw) return CS_REDIRECT_SERVICE_PICK_BRIDGE;
  if (replyAlreadyContainsServicePickBridge(raw)) return raw;
  return `${raw}\n\n${CS_REDIRECT_SERVICE_PICK_BRIDGE}`;
}

/** גוף מינימלי לתפריט Meta — בלי טקסט שאלת בחירת מוצר */
const SERVICE_PICK_MENU_BODY_BUTTONS_ONLY = "\u200e";

type ServiceRow = { name: string };

/** גשר + כפתורי בחירת מוצר בלבד (בלי טקסט multi_service_question), והמשך פלואו משלב בחירת מוצר. */
export async function offerServicePickAfterCustomerServiceRedirect(input: {
  knowledge: BusinessKnowledgePack;
  salesFlowServices: ServiceRow[];
  msg: { toNumber: string; from: string };
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
  /** כשהגשר כבר נשלח בתוך הודעת ה-AI — שולחים רק כפתורים עם גוף מינימלי */
  bridgeAlreadyInPriorMessage?: boolean;
}): Promise<boolean> {
  if (!input.knowledge.salesFlowConfig) return false;
  const labels = input.salesFlowServices.map((s) => s.name.trim()).filter(Boolean).slice(0, 12);
  if (labels.length < 2) return false;

  const menuBody = input.bridgeAlreadyInPriorMessage
    ? SERVICE_PICK_MENU_BODY_BUTTONS_ONLY
    : CS_REDIRECT_SERVICE_PICK_BRIDGE;
  const menuFooter = getZoeWhatsAppMenuFooter(resolveBusinessContentLanguageFromKnowledge(input.knowledge));

  if (isMetaCloudPhoneNumberId(input.msg.toNumber) && resolveMetaAccessToken()) {
    await sendWhatsAppTextOrMenu(
      input.msg.toNumber,
      input.msg.from,
      menuBody,
      labels,
      input.accountSid,
      input.authToken,
      { footerHint: menuFooter, language: resolveBusinessContentLanguageFromKnowledge(input.knowledge) }
    ).catch((e) => console.error("[WA Webhook] CS redirect service pick menu failed:", e));
  } else {
    const numbered = labels.map((l, i) => `${i + 1}. ${l}`).join("\n");
    const full = `${menuBody}\n\n${numbered}`;
    await sendWhatsAppMessage(input.msg.toNumber, input.msg.from, full, input.accountSid, input.authToken).catch(
      (e) => console.error("[WA Webhook] CS redirect service pick (Twilio) failed:", e)
    );
  }

  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: [menuBody, labels.map((l, i) => `${i + 1}. ${l}`).join("\n")].filter(Boolean).join("\n\n"),
    model_used: "sales_flow_cs_redirect_service_pick",
    session_id: input.sessionId,
  });

  const phoneVariants = contactPhoneLookupVariants(input.msg.from);
  await input.supabase
    .from("contacts")
    .update(salesFlowOpeningResetPatch())
    .eq("business_id", input.businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [input.msg.from]);

  return true;
}

/** הודעת שירות לקוחות + גשר + כפתורי בחירת מוצר (ללא multi_service_question). */
export async function sendCustomerServiceRedirectWithServicePickFollowUp(input: {
  csMessage: string;
  modelUsed: string;
  knowledge: BusinessKnowledgePack;
  salesFlowServices: ServiceRow[];
  msg: { toNumber: string; from: string };
  accountSid: string;
  authToken: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: string;
  business_slug: string;
  sessionId: string;
}): Promise<void> {
  const text = appendCsRedirectServicePickBridge(input.csMessage);
  await sendWhatsAppMessage(
    input.msg.toNumber,
    input.msg.from,
    text,
    input.accountSid,
    input.authToken
  ).catch((e) => console.error("[WA Webhook] CS redirect message failed:", e));

  await logMessage({
    business_slug: input.business_slug,
    role: "assistant",
    content: text,
    model_used: input.modelUsed,
    session_id: input.sessionId,
  });

  if (!input.knowledge.salesFlowConfig || input.salesFlowServices.length < 2) return;

  await sleepMs(650);
  await offerServicePickAfterCustomerServiceRedirect({
    knowledge: input.knowledge,
    salesFlowServices: input.salesFlowServices,
    msg: input.msg,
    accountSid: input.accountSid,
    authToken: input.authToken,
    supabase: input.supabase,
    businessId: input.businessId,
    business_slug: input.business_slug,
    sessionId: input.sessionId,
    bridgeAlreadyInPriorMessage: true,
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
