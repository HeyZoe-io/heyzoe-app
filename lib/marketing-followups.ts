import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { matchesMarketingRegisteredClick } from "@/lib/admin-marketing-analytics";
import {
  marketingWaSessionId,
  MARKETING_CONVERSATIONS_SLUG,
  sendMarketingWhatsApp,
} from "@/lib/marketing-whatsapp";
import { normalizePhone } from "@/lib/phone-normalize";

export const MARKETING_FOLLOWUP_1_TEXT =
  "היי, ראיתי שעצרנו באמצע 😊\nיש משהו שעוד לא ברור?\nאני כאן לכל שאלה 🙌";

export const MARKETING_FOLLOWUP_2_TEXT =
  "היי שוב! זואי כאן 😊\nאני מזכירה שאפשר לכתוב לי כל שאלה ואענה.\nבמידה ולא קיבלת מענה מספק ממני,\nאני לא נעלבת, אני אחרי הכל בוט ללא מערכת עצבים,\nאשמח להעביר את הפנייה למחלקה האנושית 🙂\nקליק כאן: https://wa.me/972508318162?text=%D7%90%D7%99%D7%9F%20%D7%9C%D7%99%20%D7%90%D7%AA%D7%A8%3F";

export const MARKETING_FOLLOWUP_3_TEXT =
  "היי שם! זו הודעה אחרונה לפני שאני מניחה לך.\nשוב מזכירה שאני כאן לענות לכל שאלה או חשש.\nאפשר לכתוב לי ואענה,\nאו לדבר ישירות עם השירות לקוחות:\nhttps://wa.me/972508318162?text=%D7%90%D7%99%D7%9F%20%D7%9C%D7%99%20%D7%90%D7%AA%D7%A8%3F";

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

export function marketingFollowupBody(stage: 1 | 2 | 3): string {
  if (stage === 1) return MARKETING_FOLLOWUP_1_TEXT;
  if (stage === 2) return MARKETING_FOLLOWUP_2_TEXT;
  return MARKETING_FOLLOWUP_3_TEXT;
}

export async function sendMarketingFollowupStage(
  phone: string,
  stage: 1 | 2 | 3
): Promise<void> {
  const body = marketingFollowupBody(stage);
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
