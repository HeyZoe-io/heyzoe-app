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
import { isAllowedWhatsAppSendTimeIsrael, nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import {
  DEFAULT_MARKETING_FOLLOWUP_CONFIG,
  MARKETING_FOLLOWUP_1_TEXT,
  MARKETING_FOLLOWUP_2_TEXT,
  MARKETING_FOLLOWUP_3_TEXT,
  marketingFollowupDelaysMs,
  resolveMarketingFollowupConfig,
  type MarketingFollowupConfig,
} from "@/lib/marketing-followup-config";

export {
  MARKETING_FOLLOWUP_1_TEXT,
  MARKETING_FOLLOWUP_2_TEXT,
  MARKETING_FOLLOWUP_3_TEXT,
};

const DEFAULT_DELAYS_MS = marketingFollowupDelaysMs(DEFAULT_MARKETING_FOLLOWUP_CONFIG);

export type MarketingFlowSessionFollowupRow = {
  id: string;
  phone: string;
  last_user_message_at: string | null;
  followup_1_sent_at: string | null;
  followup_2_sent_at: string | null;
  followup_3_sent_at: string | null;
  followup_opted_out: boolean | null;
  flow_completed: boolean;
  human_followup_at?: string | null;
  pipeline_status?: string | null;
  /** Cancelled without sending (supabase/marketing_flow_sessions_followup_skipped.sql). */
  followup_1_skipped_at?: string | null;
  followup_2_skipped_at?: string | null;
  followup_3_skipped_at?: string | null;
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

/** Sent or cancelled: either way the step is done. */
function followupSentFlags(row: MarketingFlowSessionFollowupRow): [boolean, boolean, boolean] {
  return [
    Boolean(row.followup_1_sent_at || row.followup_1_skipped_at),
    Boolean(row.followup_2_sent_at || row.followup_2_skipped_at),
    Boolean(row.followup_3_sent_at || row.followup_3_skipped_at),
  ];
}

/**
 * השלב המוקדם ביותר שעדיין לא נשלח, פעיל, וזמן ההמתנה שלו עבר.
 * נמדד מהודעת המשתמש האחרונה. שלב כבוי לא חוסם את הבאים אחריו.
 */
export function pickMarketingFollowupStage(
  row: MarketingFlowSessionFollowupRow,
  nowMs: number,
  delaysMs: readonly [number, number, number] = DEFAULT_DELAYS_MS,
  enabled: readonly [boolean, boolean, boolean] = [true, true, true]
): 0 | 1 | 2 | 3 {
  const lastAt = row.last_user_message_at ? new Date(row.last_user_message_at).getTime() : NaN;
  if (!Number.isFinite(lastAt)) return 0;
  const elapsed = nowMs - lastAt;
  if (elapsed < 0) return 0;

  const sent = followupSentFlags(row);
  for (const stage of [1, 2, 3] as const) {
    const i = stage - 1;
    if (!enabled[i] || sent[i]) continue;
    if (elapsed >= delaysMs[i]!) return stage;
  }
  return 0;
}

/** סיבת דילוג כש־pickMarketingFollowupStage מחזיר 0 (ללוגי cron) */
export function pickMarketingFollowupSkipReason(
  row: MarketingFlowSessionFollowupRow,
  nowMs: number,
  delaysMs: readonly [number, number, number] = DEFAULT_DELAYS_MS,
  enabled: readonly [boolean, boolean, boolean] = [true, true, true]
): string {
  const lastAt = row.last_user_message_at ? new Date(row.last_user_message_at).getTime() : NaN;
  if (!Number.isFinite(lastAt)) return "no_user_message_at";
  const elapsedMs = nowMs - lastAt;
  if (elapsedMs < 0) return "invalid_timestamp";

  const sent = followupSentFlags(row);
  let pendingEnabled = false;
  let pendingDisabled = false;
  for (const stage of [1, 2, 3] as const) {
    const i = stage - 1;
    if (sent[i]) continue;
    if (!enabled[i]) {
      pendingDisabled = true;
      continue;
    }
    pendingEnabled = true;
    if (elapsedMs < delaysMs[i]!) return "not_due_yet";
  }
  if (!pendingEnabled && pendingDisabled) return "stages_disabled";
  return "all_followups_sent";
}

export function marketingFollowupBody(
  stage: 1 | 2 | 3,
  config: MarketingFollowupConfig = DEFAULT_MARKETING_FOLLOWUP_CONFIG
): string {
  const custom = config.stages[stage - 1]?.text?.trim();
  if (custom) return custom;
  if (stage === 1) return MARKETING_FOLLOWUP_1_TEXT;
  if (stage === 2) return MARKETING_FOLLOWUP_2_TEXT;
  return MARKETING_FOLLOWUP_3_TEXT;
}

/** קריאה אחת לפי id=1. עמודה חסרה או ערך ריק → ברירת מחדל, עם לוג. */
export async function loadMarketingFollowupConfig(): Promise<MarketingFollowupConfig> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("marketing_flow_settings")
    .select("marketing_followups")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (/marketing_followups|column/i.test(error.message)) {
      console.error(
        "[marketing-followups] column marketing_followups missing — using defaults. Run supabase/marketing_flow_settings_followups.sql"
      );
      return DEFAULT_MARKETING_FOLLOWUP_CONFIG;
    }
    console.error("[marketing-followups] load config failed:", error.message);
    throw error;
  }
  const row = data as { marketing_followups?: unknown } | null;
  return resolveMarketingFollowupConfig(row?.marketing_followups).config;
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
  console.warn("[marketing-followups] interactive failed; sending body only");
  await sendMarketingWhatsApp(phone, body, { model_used: model });
}

/**
 * שולח פולואפ רק בחלון החוקי בישראל. מחוץ לחלון מחזיר outside_window בלי לשלוח.
 */
export async function sendMarketingFollowupStage(
  phone: string,
  stage: 1 | 2 | 3,
  bodyText?: string
): Promise<"sent" | "outside_window"> {
  const now = new Date();
  if (!isAllowedWhatsAppSendTimeIsrael(now)) {
    const nextAt = nextAllowedWhatsAppSendTimeIsrael(now);
    console.info("[marketing-followups] blocked outside send window", {
      stage,
      next_allowed_at: nextAt.toISOString(),
    });
    return "outside_window";
  }
  const body = (bodyText ?? marketingFollowupBody(stage)).trim();
  if (!body) {
    console.error("[marketing-followups] empty body", { stage });
    throw new Error("empty_followup_body");
  }
  if (stage === 2 || stage === 3) {
    await sendMarketingFollowupWithHumanButton(phone, body, stage);
    return "sent";
  }
  await sendMarketingWhatsApp(phone, body, { model_used: `marketing_followup_${stage}` });
  return "sent";
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

export function isMissingFollowupSkippedColumn(message: string | null | undefined): boolean {
  return /followup_[123]_skipped_at/i.test(String(message ?? ""));
}

/**
 * A step cancelled without sending. Until the skipped_at columns exist, falls back to
 * followup_N_sent_at = the original due time, so the step is still never sent.
 */
export async function markMarketingFollowupSkipped(
  sessionId: string,
  stage: 1 | 2 | 3,
  dueAtIso: string
): Promise<"skipped" | "sent_fallback"> {
  const admin = createSupabaseAdminClient();
  const skipped = await admin
    .from("marketing_flow_sessions")
    .update({ [`followup_${stage}_skipped_at`]: new Date().toISOString() })
    .eq("id", sessionId);
  if (!skipped.error) return "skipped";
  if (!isMissingFollowupSkippedColumn(skipped.error.message)) {
    console.error("[marketing-followups] mark skipped failed:", skipped.error.message);
    throw skipped.error;
  }
  console.error(
    "[marketing-followups] followup_N_skipped_at missing — run supabase/marketing_flow_sessions_followup_skipped.sql"
  );
  const fallback = await admin
    .from("marketing_flow_sessions")
    .update({ [`followup_${stage}_sent_at`]: dueAtIso })
    .eq("id", sessionId);
  if (fallback.error) {
    console.error("[marketing-followups] mark skipped fallback failed:", fallback.error.message);
    throw fallback.error;
  }
  return "sent_fallback";
}
