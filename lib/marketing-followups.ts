import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { matchesMarketingRegisteredClick } from "@/lib/admin-marketing-analytics";
import { MARKETING_HUMAN_AGENT_BTN_LABEL } from "@/lib/marketing-human-agent";
import {
  MARKETING_CONVERSATIONS_SLUG,
  logMarketingWhatsAppMessage,
  sendMarketingWhatsApp,
  MARKETING_WA_PHONE_NUMBER_ID,
} from "@/lib/marketing-whatsapp";
import { buildMetaInteractivePayload, sendMetaWhatsAppMessage } from "@/lib/whatsapp";
import { normalizePhone } from "@/lib/phone-normalize";

export const MARKETING_FOLLOWUP_1_TEXT =
  "היי, ראיתי שעצרנו באמצע 😊\nיש משהו שעוד לא ברור?\nאני כאן לכל שאלה 🙌";

/** בלי קישור wa.me לליד — כפתור «נציג אנושי» מפעיל template לבעלים + הודעה לליד */
export const MARKETING_FOLLOWUP_2_TEXT =
  "היי שוב! זואי כאן 😊\nאני מזכירה שאפשר לכתוב לי כל שאלה ואענה.\nבמידה ולא קיבלת מענה מספק ממני, אני לא נעלבת — אחרי הכל אני בוט בלי מערכת רגשות 😊\nרוצים נציג אנושי? לחצו על הכפתור למטה.";

export const MARKETING_FOLLOWUP_3_TEXT =
  "היי! זו הודעה אחרונה לפני שאני מניחה לך.\nשוב — אני כאן לכל שאלה או חשש.\nרוצים לדבר עם נציג? לחצו «נציג אנושי» למטה.";

const MS_10_MIN = 10 * 60 * 1000;
const MS_2_H = 2 * 60 * 60 * 1000;
const MS_23_H = 23 * 60 * 60 * 1000;

export type MarketingFlowSessionFollowupRow = {
  id: string;
  phone: string;
  last_user_message_at: string | null;
  followup_1_sent_at: string | null;
  followup_2_sent_at: string | null;
  followup_3_sent_at: string | null;
  followup_opted_out: boolean | null;
  flow_completed: boolean;
};

/** עדכון שם פרופיל וואטסאפ לסשן שיווקי קיים */
export async function touchMarketingLeadDisplayName(
  phoneRaw: string,
  displayNameRaw: string
): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  const full_name = String(displayNameRaw ?? "").trim();
  if (!phone || !full_name) return;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("marketing_flow_sessions")
    .update({ full_name, updated_at: new Date().toISOString() })
    .eq("phone", phone);
  if (error && !/full_name|column/i.test(String(error.message ?? ""))) {
    console.warn("[marketing-followups] touch full_name:", error.message);
  }
}

/** עדכון זמן הודעת משתמש אחרונה (לא מאפס דגלי פולואפ שנשלחו). */
export async function touchMarketingLeadLastUserMessage(phoneRaw: string): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("marketing_flow_sessions")
    .update({ last_user_message_at: nowIso, updated_at: nowIso })
    .eq("phone", phone);
  if (error && !/last_user_message_at|column/i.test(String(error.message ?? ""))) {
    console.warn("[marketing-followups] touch last_user_message_at:", error.message);
  }
}

/** opt-out מפולואפים אוטומטיים (נשלח פעם אחת — לא מתאפס). */
export async function markMarketingFollowupOptedOut(phoneRaw: string): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("marketing_flow_sessions")
    .update({ followup_opted_out: true, updated_at: nowIso })
    .eq("phone", phone);
  if (error && !/followup_opted_out|column/i.test(String(error.message ?? ""))) {
    console.warn("[marketing-followups] opt-out update:", error.message);
  }
}

export async function applyMarketingInboundFollowupSideEffects(
  phoneRaw: string,
  userText: string
): Promise<void> {
  await touchMarketingLeadLastUserMessage(phoneRaw);
  if (matchesMarketingRegisteredClick(userText)) {
    await markMarketingFollowupOptedOut(phoneRaw);
  }
}

export async function sessionHasMarketingRegisteredMessage(sessionId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("content")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) return false;
  for (const row of data ?? []) {
    if (matchesMarketingRegisteredClick(String((row as { content?: string }).content ?? ""))) {
      return true;
    }
  }
  return false;
}

export function pickMarketingFollowupStage(row: MarketingFlowSessionFollowupRow, nowMs: number): 0 | 1 | 2 | 3 {
  const lastAt = row.last_user_message_at ? new Date(row.last_user_message_at).getTime() : NaN;
  if (!Number.isFinite(lastAt)) return 0;
  const elapsed = nowMs - lastAt;
  if (elapsed < 0) return 0;

  if (!row.followup_3_sent_at && elapsed >= MS_23_H) return 3;
  if (!row.followup_2_sent_at && elapsed >= MS_2_H) return 2;
  if (!row.followup_1_sent_at && elapsed >= MS_10_MIN) return 1;
  return 0;
}

/** סיבת דילוג כש־pickMarketingFollowupStage מחזיר 0 (ללוגי cron) */
export function pickMarketingFollowupSkipReason(
  row: MarketingFlowSessionFollowupRow,
  nowMs: number
): string {
  const lastAt = row.last_user_message_at ? new Date(row.last_user_message_at).getTime() : NaN;
  if (!Number.isFinite(lastAt)) return "no_user_message_at";
  const elapsedMs = nowMs - lastAt;
  if (elapsedMs < 0) return "invalid_timestamp";

  if (row.followup_1_sent_at && row.followup_2_sent_at && row.followup_3_sent_at) {
    return "all_followups_sent";
  }
  if (!row.followup_1_sent_at && elapsedMs < MS_10_MIN) return "not_due_yet";
  if (!row.followup_2_sent_at && row.followup_1_sent_at && elapsedMs < MS_2_H) return "not_due_yet";
  if (!row.followup_3_sent_at && row.followup_2_sent_at && elapsedMs < MS_23_H) return "not_due_yet";
  return "not_due_yet";
}

export function marketingFollowupBody(stage: 1 | 2 | 3): string {
  if (stage === 1) return MARKETING_FOLLOWUP_1_TEXT;
  if (stage === 2) return MARKETING_FOLLOWUP_2_TEXT;
  return MARKETING_FOLLOWUP_3_TEXT;
}

async function sendMarketingFollowupWithHumanButton(
  phone: string,
  body: string,
  stage: 2 | 3
): Promise<void> {
  const model = `marketing_followup_${stage}`;
  const interactive = buildMetaInteractivePayload(body, [MARKETING_HUMAN_AGENT_BTN_LABEL]);
  if (interactive) {
    await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, interactive);
    await logMarketingWhatsAppMessage({
      leadPhone: phone,
      role: "assistant",
      content: `${body}\n[כפתור: ${MARKETING_HUMAN_AGENT_BTN_LABEL}]`,
      model_used: model,
    });
    return;
  }
  const fallback = `${body}\n1. ${MARKETING_HUMAN_AGENT_BTN_LABEL}`;
  await sendMarketingWhatsApp(phone, fallback, { model_used: model });
}

export async function sendMarketingFollowupStage(
  phone: string,
  stage: 1 | 2 | 3
): Promise<void> {
  const body = marketingFollowupBody(stage);
  if (stage === 2 || stage === 3) {
    await sendMarketingFollowupWithHumanButton(phone, body, stage);
    return;
  }
  await sendMarketingWhatsApp(phone, body, { model_used: `marketing_followup_${stage}` });
}

export async function markMarketingFollowupSent(
  sessionId: string,
  stage: 1 | 2 | 3
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const patch: Record<string, string> = { updated_at: nowIso };
  if (stage === 1) patch.followup_1_sent_at = nowIso;
  if (stage === 2) patch.followup_2_sent_at = nowIso;
  if (stage === 3) patch.followup_3_sent_at = nowIso;
  const { error } = await admin.from("marketing_flow_sessions").update(patch).eq("id", sessionId);
  if (error) {
    console.error("[marketing-followups] mark sent failed:", error.message);
    throw error;
  }
}
