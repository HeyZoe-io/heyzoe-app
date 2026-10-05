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
  "היי ליאור, נחסמה שליחה כפולה. עסק {{1}}, טריגר {{2}}, נחסמו {{3}} שליחות, בשעה {{4}}. כדאי לבדוק את הלוגים.";

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
    await flushPendingDuplicateAlarms();
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
      update: (row: Record<string, unknown>) => AlarmQuery;
    };
  };
  const sessionId = `dup:${group.businessId}:${group.triggerType}`;
  const since = new Date(now.getTime() - THROTTLE_MS).toISOString();
  const { data: recent, error: recentErr } = await db
    .from("messages")
    .select("id, error_code")
    .eq("business_slug", THROTTLE_SLUG)
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .gte("created_at", since)
    .limit(5);
  if (recentErr) {
    console.error("[duplicate-block-alarm] throttle read failed", recentErr.message);
    return;
  }
  const recentRows = Array.isArray(recent)
    ? (recent as Array<{ id?: unknown; error_code?: unknown }>)
    : [];
  if (recentRows.some((row) => String(row.error_code ?? "") !== "admin_alert_pending")) return;
  const pendingId = String(
    recentRows.find((row) => String(row.error_code ?? "") === "admin_alert_pending")?.id ?? ""
  ).trim();

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

  const content = JSON.stringify({
    slug,
    trigger_type: group.triggerType,
    blocked_count: countText,
    time: when,
  });
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
    await rememberAlarm(db, {
      id: pendingId,
      sessionId,
      content,
      errorCode: "admin_alert_pending",
    });
    return;
  }

  const sent = await sendAdminWhatsAppTemplate({
    to: ADMIN_SUPPORT_ALERT_WHATSAPP,
    templateName: DUPLICATE_ALARM_TEMPLATE,
    languageCode: "he",
    bodyParams: [slug, group.triggerType, countText, when],
  });
  if (!sent.ok) {
    console.error("[duplicate-block-alarm] whatsapp failed", sent.error);
    await rememberAlarm(db, {
      id: pendingId,
      sessionId,
      content,
      errorCode: "admin_alert_pending",
    });
    return;
  }
  await rememberAlarm(db, { id: pendingId, sessionId, content, errorCode: null });
}

async function rememberAlarm(
  db: {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
      update: (row: Record<string, unknown>) => {
        eq: (column: string, value: unknown) => PromiseLike<{ error: { message?: string } | null }>;
      };
    };
  },
  input: { id: string; sessionId: string; content: string; errorCode: string | null }
): Promise<void> {
  const row = {
    business_slug: THROTTLE_SLUG,
    role: "assistant",
    session_id: input.sessionId,
    model_used: "admin_duplicate_alarm",
    content: input.content,
    error_code: input.errorCode,
  };
  const { error } = input.id
    ? await db.from("messages").update({ content: input.content, error_code: input.errorCode }).eq("id", input.id)
    : await db.from("messages").insert(row);
  if (error) console.error("[duplicate-block-alarm] throttle write failed", error.message);
}

/** Sends stored admin_alert_pending rows after Meta approves the template. */
export async function flushPendingDuplicateAlarms(): Promise<number> {
  try {
    const { createSupabaseAdminClient } = await import("@/lib/supabase-admin");
    const admin = createSupabaseAdminClient();
    const { data: tpl, error: tplErr } = await admin
      .from("marketing_whatsapp_templates")
      .select("status, disabled")
      .eq("name", DUPLICATE_ALARM_TEMPLATE)
      .eq("language", "he")
      .maybeSingle();
    if (tplErr) {
      console.error("[duplicate-block-alarm] pending template lookup failed", tplErr.message);
      return 0;
    }
    const status = String((tpl as { status?: unknown } | null)?.status ?? "").toUpperCase();
    const disabled = Boolean((tpl as { disabled?: unknown } | null)?.disabled);
    if (status !== "APPROVED" || disabled) return 0;

    const { data, error } = await admin
      .from("messages")
      .select("id, content")
      .eq("business_slug", THROTTLE_SLUG)
      .eq("model_used", "admin_duplicate_alarm")
      .eq("error_code", "admin_alert_pending")
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) {
      console.error("[duplicate-block-alarm] pending read failed", error.message);
      return 0;
    }
    let sentCount = 0;
    for (const row of data ?? []) {
      const id = String((row as { id?: unknown }).id ?? "").trim();
      let parsed: { slug?: unknown; trigger_type?: unknown; blocked_count?: unknown; time?: unknown };
      try {
        parsed = JSON.parse(String((row as { content?: unknown }).content ?? "")) as typeof parsed;
      } catch {
        continue;
      }
      const slug = String(parsed.slug ?? "").trim();
      const triggerType = String(parsed.trigger_type ?? "").trim();
      const countText = String(parsed.blocked_count ?? "").trim();
      const when = String(parsed.time ?? "").trim();
      if (!id || !slug || !triggerType || !countText || !when) continue;
      const sent = await sendAdminWhatsAppTemplate({
        to: ADMIN_SUPPORT_ALERT_WHATSAPP,
        templateName: DUPLICATE_ALARM_TEMPLATE,
        languageCode: "he",
        bodyParams: [slug, triggerType, countText, when],
      });
      if (!sent.ok) {
        console.error("[duplicate-block-alarm] pending whatsapp failed", sent.error);
        continue;
      }
      const { error: markErr } = await admin
        .from("messages")
        .update({ error_code: null })
        .eq("id", id);
      if (markErr) {
        console.error("[duplicate-block-alarm] pending mark failed", markErr.message);
        continue;
      }
      sentCount += 1;
    }
    return sentCount;
  } catch (e) {
    console.error("[duplicate-block-alarm] pending flush failed", e);
    return 0;
  }
}
