import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { markMarketingFollowupOptedOut } from "@/lib/marketing-followups";
import {
  MARKETING_CONVERSATIONS_SLUG,
  marketingWaSessionId,
  normalizeMarketingInboundText,
  sendMarketingWhatsApp,
} from "@/lib/marketing-whatsapp";
import { sendOwnerNotification } from "@/lib/notifications/sendOwnerNotification";
import { normalizePhone } from "@/lib/phone-normalize";

export const MARKETING_HUMAN_AGENT_BTN_LABEL = "נציג אנושי";

export const MARKETING_HUMAN_AGENT_LEAD_REPLY =
  "אין בעיה, נציג אנושי יצור איתכם קשר כאן ממש בקרוב! 😊";

export const MARKETING_HUMAN_AGENT_NOTIFY_PHONE = "972508318162";

export const MARKETING_HUMAN_AGENT_TEMPLATE = "marketing_human_agent_request";

function formatLeadPhoneForTemplate(phone: string): string {
  const d = normalizePhone(phone) ?? String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) return `0${d.slice(3)}`;
  return d;
}

function labelMatchesChoice(text: string, choice: string): boolean {
  const n = normalizeMarketingInboundText(text).toLowerCase().replace(/[!?.…]+$/gu, "").trim();
  const c = normalizeMarketingInboundText(choice).toLowerCase().replace(/[!?.…]+$/gu, "").trim();
  return Boolean(n && c && n === c);
}

/** זיהוי בקשת נציג אנושי (טקסט חופשי או כפתור «נציג אנושי»). */
export function isMarketingHumanAgentRequest(userText: string): boolean {
  if (labelMatchesChoice(userText, MARKETING_HUMAN_AGENT_BTN_LABEL)) return true;
  const raw = String(userText ?? "").trim();
  if (!raw) return false;
  const t = raw.toLowerCase();
  const hebrew =
    /נציג|נציגה|בן\s*אדם|אדם\s*אמיתי|מענה\s*אנושי|דברו\s*איתי|לדבר\s*עם\s*מישהו|לדבר\s*עם\s*אדם|העבר(ה|י)\s*ל|תחבר(ו|י)\s*אותי|אפשר\s*לדבר\s*עם|מישהו\s*אמיתי|נציג\s*אנושי|שירות\s*אנושי|לא\s*רובוט|לא\s*בוט|עם\s*בשר\s*ודם|(אני\s*)?(רוצה|צריך|צריכה|מעוניין|מעוניינת|מבקש|מבקשת).{0,50}שירות\s*לקוחות|שירות\s*לקוחות.{0,20}(בבקשה|עכשיו)|מעבר\s*לנציג/i.test(
      raw
    );
  const english =
    /\b(human|agent|representative|real\s*person|customer\s*service|talk\s*to\s*(a\s*)?(human|person|someone)|speak\s*to\s*(a\s*)?(human|person))\b/i.test(
      t
    );
  return hebrew || english;
}

/** כבר נשלחה לליד הודעת העברה/נציג (פלואו, off-niche, או התשובה החדשה). */
export async function recentAssistantSentMarketingHumanHandoff(phoneRaw: string): Promise<boolean> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return false;
  const admin = createSupabaseAdminClient();
  const sessionId = marketingWaSessionId(phone);
  const { data } = await admin
    .from("messages")
    .select("content, model_used")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(12);

  const leadSnippet = MARKETING_HUMAN_AGENT_LEAD_REPLY.slice(0, 24);
  for (const row of data ?? []) {
    const content = String((row as { content?: string }).content ?? "");
    const model = String((row as { model_used?: string }).model_used ?? "");
    if (content.includes(leadSnippet)) return true;
    if (content.includes("יש מצב שיש לנו פתרון עבורך")) return true;
    if (content.includes("שלחו להם הודעה ויחזרו אליכם בקרוב")) return true;
    if (/marketing_post_flow_human|marketing_human_agent|off.niche|off_niche/i.test(model)) return true;
    if (/נציג אנושי יצור|לפנייה בנציג אנושי/i.test(content)) return true;
  }
  return false;
}

export async function sendMarketingHumanAgentOwnerNotification(phoneRaw: string): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  const display = formatLeadPhoneForTemplate(phone);
  const result = await sendOwnerNotification({
    ownerPhone: MARKETING_HUMAN_AGENT_NOTIFY_PHONE,
    templateName: MARKETING_HUMAN_AGENT_TEMPLATE,
    languageCode: "he",
    components: [
      {
        type: "body",
        parameters: [{ type: "text", text: display }],
      },
    ],
  });
  if (!result.ok) {
    console.warn("[marketing-human-agent] owner template failed:", result.error);
  } else {
    console.info("[marketing-human-agent] owner template sent for lead:", display);
  }
}

/** התראה + opt-out מפולואפים (בלי הודעה לליד). */
export async function applyMarketingHumanAgentSideEffects(phoneRaw: string): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  await markMarketingFollowupOptedOut(phone);
  await sendMarketingHumanAgentOwnerNotification(phone);
}

/**
 * טיפול בבקשת נציג: הודעה לליד (אלא אם כבר נשלחה העברה בפלואו), template ל-972508318162, opt-out פולואפים.
 */
export async function handleMarketingHumanAgentRequest(
  phoneRaw: string,
  opts?: { skipLeadMessage?: boolean; forceLeadMessage?: boolean }
): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;

  await applyMarketingHumanAgentSideEffects(phone);

  const skipLead =
    opts?.skipLeadMessage ||
    (!opts?.forceLeadMessage && (await recentAssistantSentMarketingHumanHandoff(phone)));
  if (skipLead) return;

  await sendMarketingWhatsApp(phone, MARKETING_HUMAN_AGENT_LEAD_REPLY, {
    model_used: "marketing_human_agent",
  });
}

export async function tryHandleMarketingHumanAgentInbound(
  phoneRaw: string,
  userText: string
): Promise<boolean> {
  if (!isMarketingHumanAgentRequest(userText)) return false;
  await handleMarketingHumanAgentRequest(phoneRaw, {
    forceLeadMessage: labelMatchesChoice(userText, MARKETING_HUMAN_AGENT_BTN_LABEL),
  });
  return true;
}
