import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { markMarketingFollowupOptedOut } from "@/lib/marketing-followups";
import {
  MARKETING_CONVERSATIONS_SLUG,
  marketingWaSessionId,
  normalizeMarketingInboundText,
  sendMarketingWhatsApp,
} from "@/lib/marketing-whatsapp";
import { buildSinglePhoneWaParams } from "@/lib/notifications/owner-template-params";
import { sendOwnerNotification } from "@/lib/notifications/sendOwnerNotification";
import { normalizePhone } from "@/lib/phone-normalize";

export const MARKETING_HUMAN_AGENT_BTN_LABEL = "נציג אנושי";

export const MARKETING_HUMAN_AGENT_LEAD_REPLY =
  "אין בעיה, נציג אנושי יצור איתכם קשר כאן ממש בקרוב! 😊";

export const MARKETING_HUMAN_AGENT_NOTIFY_PHONE = "972508318162";

export const MARKETING_HUMAN_AGENT_TEMPLATE = "marketing_human_agent_request";

/** סימון ב-messages שנשלחה התראת אדמין (מונע כפילות משרשרת נודים / retries) */
export const MARKETING_HUMAN_AGENT_OWNER_NOTIFY_EVENT = "[heyzoe:marketing_human_agent_owner_notify]";
export const MARKETING_HUMAN_AGENT_OWNER_NOTIFY_MODEL = "marketing_human_agent_owner_notify";

/** נוד פלואו שיווקי (למשל נוד 8) — במקום טקסט חופשי שולחים template לבעלים + הודעת ליד קבועה */
export const MARKETING_FLOW_NODE_HUMAN_AGENT_ACTION = "marketing_human_agent_request";

export function isMarketingHumanAgentHandoffFlowNode(node: {
  type?: string;
  data?: Record<string, unknown> | null;
}): boolean {
  const data = (node.data && typeof node.data === "object" ? node.data : {}) as Record<string, unknown>;
  if (String(data.action ?? "").trim() === MARKETING_FLOW_NODE_HUMAN_AGENT_ACTION) return true;
  const text = String(data.text ?? "").trim();
  if (!text) return false;
  return /מעביר(ה|ים)?\s*את\s*השיחה|נציגה\s*אנושית\s*ואדאג|נציגה\s*אנושית|פתרון\s*עבורך.*נציגה|מגניב\s*מאוד.*נציג/i.test(
    text
  );
}

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

/** כבר נשלחה התראת אדמין לליד זה (event marker או model_used). */
export async function recentMarketingHumanAgentOwnerNotified(phoneRaw: string): Promise<boolean> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return false;
  const admin = createSupabaseAdminClient();
  const sessionId = marketingWaSessionId(phone);
  const { data } = await admin
    .from("messages")
    .select("content, model_used")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("session_id", sessionId)
    .in("role", ["event", "assistant"])
    .order("created_at", { ascending: false })
    .limit(20);

  for (const row of data ?? []) {
    const content = String((row as { content?: string }).content ?? "");
    const model = String((row as { model_used?: string }).model_used ?? "");
    if (content.includes(MARKETING_HUMAN_AGENT_OWNER_NOTIFY_EVENT)) return true;
    if (/marketing_human_agent_owner_notify/i.test(model)) return true;
  }
  return false;
}

async function logMarketingHumanAgentOwnerNotifyClaim(phone: string): Promise<void> {
  const { logMessage } = await import("@/lib/analytics");
  await logMessage({
    business_slug: MARKETING_CONVERSATIONS_SLUG,
    role: "event",
    content: MARKETING_HUMAN_AGENT_OWNER_NOTIFY_EVENT,
    model_used: MARKETING_HUMAN_AGENT_OWNER_NOTIFY_MODEL,
    session_id: marketingWaSessionId(phone),
  });
}

export async function sendMarketingHumanAgentOwnerNotification(phoneRaw: string): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  if (await recentMarketingHumanAgentOwnerNotified(phone)) {
    console.info("[marketing-human-agent] skip duplicate owner template for:", phone);
    return;
  }
  // claim לפני שליחה — מונע כפילות בשרשרת נודים באותו request
  await logMarketingHumanAgentOwnerNotifyClaim(phone);
  const display = formatLeadPhoneForTemplate(phone);
  const result = await sendOwnerNotification({
    ownerPhone: MARKETING_HUMAN_AGENT_NOTIFY_PHONE,
    templateName: MARKETING_HUMAN_AGENT_TEMPLATE,
    languageCode: "he",
    components: buildSinglePhoneWaParams(display),
  });
  if (!result.ok) {
    console.error("[marketing-human-agent] owner template failed:", result.error);
  } else {
    console.info("[marketing-human-agent] owner template sent for lead:", display);
  }
}

/** התראה + opt-out מפולואפים (בלי הודעה לליד). Idempotent — template פעם אחת לליד. */
export async function applyMarketingHumanAgentSideEffects(phoneRaw: string): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  await markMarketingFollowupOptedOut(phone);
  await sendMarketingHumanAgentOwnerNotification(phone);
}

/**
 * טיפול בבקשת נציג: הודעה לליד (אלא אם כבר נשלחה העברה בפלואו), template ל-972508318162, opt-out פולואפים.
 */
/** נוד פלואו: template marketing_human_agent_request ל-972508318162 + הודעה לליד */
export async function deliverMarketingHumanAgentHandoffFromFlowNode(phoneRaw: string): Promise<void> {
  await handleMarketingHumanAgentRequest(phoneRaw, { forceLeadMessage: true, fromFlowNode: true });
}

export async function handleMarketingHumanAgentRequest(
  phoneRaw: string,
  opts?: { skipLeadMessage?: boolean; forceLeadMessage?: boolean; fromFlowNode?: boolean }
): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;

  await applyMarketingHumanAgentSideEffects(phone);

  const skipLead =
    opts?.skipLeadMessage ||
    (!opts?.forceLeadMessage && (await recentAssistantSentMarketingHumanHandoff(phone)));
  if (skipLead) return;

  await sendMarketingWhatsApp(phone, MARKETING_HUMAN_AGENT_LEAD_REPLY, {
    model_used: opts?.fromFlowNode ? "marketing_flow_human_agent_node" : "marketing_human_agent",
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
