/**
 * One admin WhatsApp when a hard cap or a lost/failed claim blocks a send.
 * At most one alert per business + trigger type per hour.
 * No new table: the hour mark is one messages row on slug heyzoe-admin
 * (idx_messages_slug_session_role_created). A missing template does not block the send.
 */
import { SYNC_LOG_SENTINEL_TRIGGER_ID } from "@/lib/multi-rule-dedup";
import {
  ADMIN_SUPPORT_ALERT_WHATSAPP,
  sendAdminWhatsAppTemplate,
} from "@/lib/notifications/sendAdminWhatsAppTemplate";

export const DUPLICATE_ALARM_TEMPLATE = "admin_duplicate_send_blocked";
export const DUPLICATE_ALARM_TEMPLATE_BODY =
  "היי ליאור, נחסמה שליחה כפולה. עסק {{1}}, טריגר {{2}}, נחסמו {{3}} שליחות, שעה {{4}}.";

const ALARM_REASONS = new Set([
  "template_rule_cap",
  "free_message_cap",
  "trial_24h_cap",
  "claim_lost",
  "claim_failed",
  "claim_not_won",
  "dedup_claim_failed",
]);

const THROTTLE_SLUG = "heyzoe-admin";
const THROTTLE_MS = 60 * 60 * 1000;

export function isDuplicateBlockAlarmReason(reason: string): boolean {
  return ALARM_REASONS.has(String(reason ?? "").trim());
}

export function claimBlockReason(
  error: { code?: string; message?: string } | null | undefined
): "claim_lost" | "claim_not_won" {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  if (code === "23505" || /duplicate/i.test(message)) return "claim_lost";
  return "claim_not_won";
}

export type DuplicateBlockNote = {
  businessId: number;
  triggerId: string | null;
  triggerType?: string | null;
  count: number;
};

export function mergeDuplicateBlocks(
  items: readonly { businessId: number; triggerType?: string | null; count: number }[]
): Array<{ businessId: number; triggerType: string; count: number }> {
  const merged = new Map<string, { businessId: number; triggerType: string; count: number }>();
  for (const item of items) {
    const triggerType = String(item.triggerType ?? "").trim();
    if (!triggerType || !Number.isFinite(item.businessId)) continue;
    const key = `${item.businessId}:${triggerType}`;
    const row = merged.get(key) ?? { businessId: item.businessId, triggerType, count: 0 };
    row.count += Math.max(0, item.count);
    merged.set(key, row);
  }
  return [...merged.values()];
}

type Pending = DuplicateBlockNote & { reason: string };

const pending = new Map<string, Pending>();
let flushScheduled = false;

export function noteDuplicateBlockAlarm(input: {
  businessId: number | string | null;
  triggerId?: string | null;
  reason: string;
}): void {
  if (!isDuplicateBlockAlarmReason(input.reason)) return;
  const businessId = Number(input.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return;
  const triggerId = String(input.triggerId ?? "").trim() || null;
  const key = `${businessId}:${triggerId ?? input.reason}`;
  const row = pending.get(key) ?? { businessId, triggerId, reason: input.reason, count: 0 };
  row.count += 1;
  pending.set(key, row);
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    const batch = [...pending.values()];
    pending.clear();
    void flushDuplicateBlockAlarms(batch);
  };
  void import("next/server")
    .then(({ after }) => {
      try {
        after(run);
      } catch (e) {
        console.error("[duplicate-block-alarm] after() failed", e);
        run();
      }
    })
    .catch((e) => {
      console.error("[duplicate-block-alarm] schedule failed", e);
      run();
    });
}

function israelTime(now: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

async function resolveTriggerType(admin: unknown, note: Pending): Promise<string | null> {
  const given = String(note.triggerType ?? "").trim();
  if (given) return given;
  const triggerId = String(note.triggerId ?? "").trim();
  if (!triggerId || triggerId === SYNC_LOG_SENTINEL_TRIGGER_ID) {
    return "trial_booked";
  }
  const db = admin as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: unknown) => {
          maybeSingle: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
        };
      };
    };
  };
  const { data, error } = await db
    .from("template_triggers")
    .select("trigger_type")
    .eq("id", triggerId)
    .maybeSingle();
  if (error) {
    console.error("[duplicate-block-alarm] trigger lookup failed", error.message);
    return null;
  }
  const triggerType = String((data as { trigger_type?: unknown } | null)?.trigger_type ?? "").trim();
  return triggerType || null;
}

async function flushDuplicateBlockAlarms(batch: Pending[]): Promise<void> {
  if (!batch.length) return;
  try {
    const { createSupabaseAdminClient } = await import("@/lib/supabase-admin");
    const admin = createSupabaseAdminClient();
    const resolved: DuplicateBlockNote[] = [];
    for (const note of batch) {
      const triggerType = await resolveTriggerType(admin, note);
      if (!triggerType) {
        console.error("admin_alert_pending", {
          template_name: DUPLICATE_ALARM_TEMPLATE,
          business_id: note.businessId,
          trigger_id: note.triggerId,
          reason: "missing_trigger_type",
        });
        continue;
      }
      resolved.push({ ...note, triggerType });
    }
    const groups = mergeDuplicateBlocks(resolved);
    const now = new Date();
    for (const group of groups) {
      await sendOneAlarm(admin, group, now);
    }
  } catch (e) {
    console.error("[duplicate-block-alarm] flush failed", e);
  }
}

async function sendOneAlarm(
  admin: unknown,
  group: { businessId: number; triggerType: string; count: number },
  now: Date
): Promise<void> {
  type AlarmQuery = PromiseLike<{ data: unknown; error: { message?: string } | null }> & {
    eq: (column: string, value: unknown) => AlarmQuery;
    gte: (column: string, value: unknown) => AlarmQuery;
    limit: (n: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
    maybeSingle: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  };
  const db = admin as {
    from: (table: string) => {
      select: (columns: string) => AlarmQuery;
      insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
    };
  };
  const sessionId = `dup:${group.businessId}:${group.triggerType}`;
  const since = new Date(now.getTime() - THROTTLE_MS).toISOString();
  const { data: recent, error: recentErr } = await db
    .from("messages")
    .select("id")
    .eq("business_slug", THROTTLE_SLUG)
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .gte("created_at", since)
    .limit(1);
  if (recentErr) {
    console.error("[duplicate-block-alarm] throttle read failed", recentErr.message);
    return;
  }
  if (Array.isArray(recent) && recent.length > 0) return;

  const { data: biz, error: bizErr } = await db
    .from("businesses")
    .select("slug")
    .eq("id", group.businessId)
    .maybeSingle();
  if (bizErr) {
    console.error("[duplicate-block-alarm] business lookup failed", bizErr.message);
    return;
  }
  const slug = String((biz as { slug?: unknown } | null)?.slug ?? "").trim() || String(group.businessId);
  const when = israelTime(now);
  const countText = String(group.count);

  const { data: tpl, error: tplErr } = await db
    .from("marketing_whatsapp_templates")
    .select("status, disabled")
    .eq("name", DUPLICATE_ALARM_TEMPLATE)
    .eq("language", "he")
    .maybeSingle();
  const status = String((tpl as { status?: unknown } | null)?.status ?? "").toUpperCase();
  const disabled = Boolean((tpl as { disabled?: unknown } | null)?.disabled);
  const approved = !tplErr && status === "APPROVED" && !disabled;

  if (!approved) {
    console.error("admin_alert_pending", {
      template_name: DUPLICATE_ALARM_TEMPLATE,
      language: "he",
      category: "UTILITY",
      body: DUPLICATE_ALARM_TEMPLATE_BODY,
      body_params: ["business_slug", "trigger_type", "blocked_count", "time_israel"],
      business_slug: slug,
      trigger_type: group.triggerType,
      blocked_count: group.count,
      time: when,
      lookup_error: tplErr?.message ?? null,
    });
  } else {
    const sent = await sendAdminWhatsAppTemplate({
      to: ADMIN_SUPPORT_ALERT_WHATSAPP,
      templateName: DUPLICATE_ALARM_TEMPLATE,
      languageCode: "he",
      bodyParams: [slug, group.triggerType, countText, when],
    });
    if (!sent.ok) {
      console.error("[duplicate-block-alarm] whatsapp failed", sent.error);
      return;
    }
  }

  const { error: markErr } = await db.from("messages").insert({
    business_slug: THROTTLE_SLUG,
    role: "assistant",
    session_id: sessionId,
    model_used: "admin_duplicate_alarm",
    content: `${slug} ${group.triggerType} blocked ${countText} at ${when}`,
    error_code: approved ? null : "admin_alert_pending",
  });
  if (markErr) console.error("[duplicate-block-alarm] throttle write failed", markErr.message);
}
