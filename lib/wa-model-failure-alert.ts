/**
 * One admin WhatsApp when Claude or both models fail.
 * At most one alert per 30 minutes, globally. No new table:
 * the window is messages rows on slug heyzoe-admin
 * (idx_messages_slug_session_role_created).
 */
import {
  ADMIN_SUPPORT_ALERT_WHATSAPP,
  sendAdminWhatsAppTemplate,
} from "@/lib/notifications/sendAdminWhatsAppTemplate";
import { DUPLICATE_ALARM_TEMPLATE } from "@/lib/leads/duplicate-block-alarm";

export const MODEL_FAILURE_WINDOW_MS = 30 * 60 * 1000;
export const MODEL_FAILURE_SLUG = "heyzoe-admin";
export const MODEL_FAILURE_SESSION = "wa_ai_model_failure";
const EVENT_MODEL = "wa_ai_model_failure_event";
const ALERT_MODEL = "wa_ai_model_failure_alert";

// Supabase's filter builder is generic-deep. The webhook passes its admin client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

function israelTime(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

type Row = { role?: unknown; model_used?: unknown; created_at?: unknown };

export async function noteAiModelFailure(input: {
  admin: Admin;
  errorType: string;
  now?: Date;
}): Promise<{ alerted: boolean; count: number }> {
  const db = input.admin;
  const now = input.now ?? new Date();
  const errorType = String(input.errorType ?? "claude_failed").slice(0, 40);
  const since = new Date(now.getTime() - MODEL_FAILURE_WINDOW_MS).toISOString();

  const { error: insertErr } = await db.from("messages").insert({
    business_slug: MODEL_FAILURE_SLUG,
    role: "user",
    session_id: MODEL_FAILURE_SESSION,
    model_used: EVENT_MODEL,
    content: errorType,
    error_code: errorType,
    created_at: now.toISOString(),
  });
  if (insertErr) {
    console.error("[wa-model-failure] event write failed", insertErr.message);
  }

  const { data: recent, error: readErr } = await db
    .from("messages")
    .select("role, model_used, created_at")
    .eq("business_slug", MODEL_FAILURE_SLUG)
    .eq("session_id", MODEL_FAILURE_SESSION)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  if (readErr) {
    console.error("[wa-model-failure] throttle read failed", readErr.message);
    return { alerted: false, count: 0 };
  }
  const rows = Array.isArray(recent) ? (recent as Row[]) : [];
  const count = rows.filter((row) => String(row.model_used ?? "") === EVENT_MODEL).length;
  const alreadyAlerted = rows.some((row) => String(row.model_used ?? "") === ALERT_MODEL);
  if (alreadyAlerted) return { alerted: false, count };

  const when = israelTime(now);
  const sent = await sendAdminWhatsAppTemplate({
    to: ADMIN_SUPPORT_ALERT_WHATSAPP,
    templateName: DUPLICATE_ALARM_TEMPLATE,
    languageCode: "he",
    bodyParams: ["all", errorType, String(Math.max(1, count)), when],
  });
  if (!sent.ok) {
    console.error("[wa-model-failure] admin whatsapp failed", sent.error, { errorType, count });
    return { alerted: false, count };
  }
  const { error: markErr } = await db.from("messages").insert({
    business_slug: MODEL_FAILURE_SLUG,
    role: "assistant",
    session_id: MODEL_FAILURE_SESSION,
    model_used: ALERT_MODEL,
    content: JSON.stringify({ errorType, count, time: when }),
    created_at: now.toISOString(),
  });
  if (markErr) console.error("[wa-model-failure] alert mark failed", markErr.message);
  return { alerted: true, count };
}
