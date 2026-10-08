/**
 * Immediate Zoe Admin WhatsApp when Meta reports an error that stops a whole business from
 * sending: payment, account locked / restricted, number disconnected, template paused / disabled.
 * Sources: status webhooks (persistMetaStatusEvents) and synchronous Graph errors
 * (recordTemplateSendFailure).
 *
 * At most one alert per business per error code per 6 hours:
 * public.claim_wa_blocking_error_alert (supabase/wa_blocking_error_alerts.sql) is one atomic
 * statement. Before that SQL runs: a messages lookup on the model tag plus an in-memory throttle.
 *
 * IO / cost: nothing for non-blocking events. Per blocking (business, code) in a batch: one claim
 * RPC; only the winner reads the business name and the template status and sends one Meta template.
 * Worst case ≈ 4 sends per business per code per day, independent of message volume.
 */
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { MARKETING_CONVERSATIONS_SLUG, MARKETING_WA_PHONE_NUMBER_ID, logMarketingWhatsAppMessage } from "@/lib/marketing-whatsapp";
import { ADMIN_SUPPORT_ALERT_WHATSAPP, sendAdminWhatsAppTemplate } from "@/lib/notifications/sendAdminWhatsAppTemplate";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const BLOCKING_ALERT_WINDOW_MINUTES = 6 * 60;
export const BLOCKING_ALERT_MODEL = "wa_blocking_error_alert";
/** Dedicated template (submit in WhatsApp Manager). Until APPROVED, zoe_admin_daily_unsent carries the alert. */
export const BLOCKING_ALERT_TEMPLATE = "zoe_admin_blocking_error";
const FALLBACK_TEMPLATE = "zoe_admin_daily_unsent";

const BLOCKING: Record<number, { problem: string; action: string }> = {
  131042: {
    problem: "בעיית תשלום בחשבון Meta של העסק - שום תבנית לא יוצאת",
    action: "להיכנס ל-Business Manager > Billing של חשבון הוואטסאפ ולעדכן אמצעי תשלום או להסדיר חוב",
  },
  131031: {
    problem: "חשבון הוואטסאפ העסקי ננעל על ידי Meta",
    action: "לבדוק ב-WhatsApp Manager > Account quality ולהגיש ערעור",
  },
  368: {
    problem: "החשבון חסום זמנית בגלל הפרת מדיניות",
    action: "לבדוק ב-Account quality מה הופר, לעצור שליחות שיווקיות ולערער אם צריך",
  },
  131045: {
    problem: "מספר הטלפון של העסק לא רשום (תעודה לא תקינה)",
    action: "לבדוק ב-WhatsApp Manager > Phone numbers שהמספר מחובר, ולחבר מחדש אם צריך",
  },
  133010: {
    problem: "מספר הטלפון של העסק התנתק מ-Cloud API",
    action: "לרשום מחדש את המספר או לחבר מחדש את הוואטסאפ מהדשבורד",
  },
  132015: {
    problem: "תבנית הושהתה בגלל איכות נמוכה - הכללים שמשתמשים בה לא שולחים",
    action: "לערוך את התבנית או להחליף אותה בכללים בתבנית מאושרת אחרת",
  },
  132016: {
    problem: "תבנית בוטלה לצמיתות על ידי Meta - הכללים שמשתמשים בה לא שולחים",
    action: "ליצור תבנית חדשה ולעדכן את הכללים שמשתמשים בה",
  },
};

export function blockingErrorInfo(code: unknown): { problem: string; action: string } | null {
  const n = Number(code);
  return Number.isFinite(n) ? BLOCKING[Math.trunc(n)] ?? null : null;
}

export function isBusinessBlockingError(code: unknown): boolean {
  return blockingErrorInfo(code) != null;
}

export type BlockingErrorEvent = {
  businessId: number;
  errorCode: number;
  /** Template name or Meta title, appended to the alert when present. */
  detail?: string | null;
  source: "status_webhook" | "send_api";
};

export function blockingAlertModel(businessId: number, errorCode: number): string {
  return `${BLOCKING_ALERT_MODEL}:${businessId}:${errorCode}`;
}

export function renderBlockingAlertText(input: {
  businessName: string;
  errorCode: number;
  detail?: string | null;
}): { problem: string; action: string; text: string } {
  const info = blockingErrorInfo(input.errorCode) ?? {
    problem: `שגיאה חוסמת מ-Meta`,
    action: "לבדוק ב-WhatsApp Manager",
  };
  const detail = String(input.detail ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const problem = `${info.problem} (קוד ${input.errorCode}${detail ? `, ${detail}` : ""})`;
  const text = `🚨 חסימה בוואטסאפ של ${input.businessName}: ${problem}. מה לעשות: ${info.action}.`;
  return { problem, action: info.action, text };
}

const memoryThrottle = new Map<string, number>();
let templateCache: { approved: boolean; at: number } | null = null;

export function resetBlockingAlertThrottle(): void {
  memoryThrottle.clear();
  templateCache = null;
}

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  return (
    String(error.code ?? "") === "PGRST202" ||
    String(error.code ?? "") === "42883" ||
    /could not find the function|wa_blocking_error_alerts|does not exist/i.test(String(error.message ?? ""))
  );
}

type ClaimResult = "claimed" | "throttled" | "error";

async function claimAlert(admin: Admin, ev: BlockingErrorEvent, nowMs: number): Promise<{ result: ClaimResult; viaRpc: boolean }> {
  const key = `${ev.businessId}:${ev.errorCode}`;
  const windowMs = BLOCKING_ALERT_WINDOW_MINUTES * 60_000;
  const last = memoryThrottle.get(key);
  if (last != null && nowMs - last < windowMs) return { result: "throttled", viaRpc: false };

  const { data, error } = await admin.rpc("claim_wa_blocking_error_alert", {
    p_business_id: ev.businessId,
    p_error_code: ev.errorCode,
    p_window_minutes: BLOCKING_ALERT_WINDOW_MINUTES,
  });
  if (!error) {
    if (data === true) {
      memoryThrottle.set(key, nowMs);
      return { result: "claimed", viaRpc: true };
    }
    memoryThrottle.set(key, nowMs);
    return { result: "throttled", viaRpc: true };
  }
  if (!isMissingRpc(error)) {
    console.error("[wa-blocking-alert] claim failed:", error.message);
    return { result: "error", viaRpc: true };
  }

  const { data: prior, error: priorErr } = await admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("model_used", blockingAlertModel(ev.businessId, ev.errorCode))
    .gte("created_at", new Date(nowMs - windowMs).toISOString())
    .limit(1);
  if (priorErr) {
    console.error("[wa-blocking-alert] fallback throttle lookup failed:", priorErr.message);
    return { result: "error", viaRpc: false };
  }
  memoryThrottle.set(key, nowMs);
  return { result: prior?.length ? "throttled" : "claimed", viaRpc: false };
}

async function releaseAlert(admin: Admin, ev: BlockingErrorEvent, viaRpc: boolean): Promise<void> {
  memoryThrottle.delete(`${ev.businessId}:${ev.errorCode}`);
  if (!viaRpc) return;
  const { error } = await admin.rpc("release_wa_blocking_error_alert", {
    p_business_id: ev.businessId,
    p_error_code: ev.errorCode,
    p_window_minutes: BLOCKING_ALERT_WINDOW_MINUTES,
  });
  if (error) console.error("[wa-blocking-alert] release failed:", error.message);
}

async function dedicatedTemplateApproved(admin: Admin, nowMs: number): Promise<boolean> {
  if (templateCache && nowMs - templateCache.at < 10 * 60_000) return templateCache.approved;
  const { data, error } = await admin
    .from("marketing_whatsapp_templates")
    .select("status, disabled")
    .eq("name", BLOCKING_ALERT_TEMPLATE)
    .eq("language", "he")
    .limit(1);
  if (error) console.error("[wa-blocking-alert] template status read failed:", error.message);
  const row = (data?.[0] ?? null) as { status?: unknown; disabled?: unknown } | null;
  const approved = String(row?.status ?? "").toUpperCase() === "APPROVED" && row?.disabled !== true;
  templateCache = { approved, at: nowMs };
  return approved;
}

export type BlockingAlertOutcome = {
  businessId: number;
  errorCode: number;
  outcome: "sent" | "throttled" | "claim_error" | "send_failed";
  template?: string;
  error?: string;
};

export type BlockingAlertSend = typeof sendAdminWhatsAppTemplate;

/** Never throws. Dedupes the batch by (business, code) before claiming. */
export async function alertBusinessBlockingErrors(
  events: readonly BlockingErrorEvent[],
  opts: { admin?: Admin; now?: Date; send?: BlockingAlertSend; log?: typeof logMarketingWhatsAppMessage } = {}
): Promise<BlockingAlertOutcome[]> {
  const unique = new Map<string, BlockingErrorEvent>();
  for (const ev of events) {
    if (!Number.isFinite(ev.businessId) || ev.businessId <= 0 || !isBusinessBlockingError(ev.errorCode)) continue;
    const key = `${ev.businessId}:${ev.errorCode}`;
    if (!unique.has(key)) unique.set(key, ev);
  }
  if (!unique.size) return [];
  const out: BlockingAlertOutcome[] = [];
  try {
    const admin = opts.admin ?? createSupabaseAdminClient();
    const nowMs = (opts.now ?? new Date()).getTime();
    const send = opts.send ?? sendAdminWhatsAppTemplate;
    const log = opts.log ?? logMarketingWhatsAppMessage;
    for (const ev of unique.values()) {
      const claim = await claimAlert(admin, ev, nowMs);
      if (claim.result !== "claimed") {
        out.push({
          businessId: ev.businessId,
          errorCode: ev.errorCode,
          outcome: claim.result === "throttled" ? "throttled" : "claim_error",
        });
        continue;
      }
      const { data: biz } = await admin.from("businesses").select("name, slug").eq("id", ev.businessId).maybeSingle();
      const businessName =
        String((biz as { name?: unknown } | null)?.name ?? "").trim() ||
        String((biz as { slug?: unknown } | null)?.slug ?? "").trim() ||
        `עסק ${ev.businessId}`;
      const rendered = renderBlockingAlertText({ businessName, errorCode: ev.errorCode, detail: ev.detail });
      const dedicated = await dedicatedTemplateApproved(admin, nowMs);
      const template = dedicated ? BLOCKING_ALERT_TEMPLATE : FALLBACK_TEMPLATE;
      const bodyParams = dedicated
        ? [businessName, rendered.problem, rendered.action]
        : ["1", `התראה מיידית, לא הדוח היומי. ${rendered.text.replace(/\.$/, "")}`];
      const sent = await send({
        to: ADMIN_SUPPORT_ALERT_WHATSAPP,
        templateName: template,
        languageCode: "he",
        bodyParams,
      });
      if (!sent.ok) {
        console.error("[wa-blocking-alert] send failed", {
          businessId: ev.businessId,
          errorCode: ev.errorCode,
          template,
          error: sent.error,
        });
        await releaseAlert(admin, ev, claim.viaRpc);
        out.push({ businessId: ev.businessId, errorCode: ev.errorCode, outcome: "send_failed", template, error: sent.error });
        continue;
      }
      await log({
        leadPhone: ADMIN_SUPPORT_ALERT_WHATSAPP,
        role: "assistant",
        content: rendered.text,
        model_used: blockingAlertModel(ev.businessId, ev.errorCode),
      }).catch((e) => console.error("[wa-blocking-alert] log failed:", e instanceof Error ? e.message : e));
      console.warn("[wa-blocking-alert] sent", { businessId: ev.businessId, errorCode: ev.errorCode, source: ev.source, template });
      out.push({ businessId: ev.businessId, errorCode: ev.errorCode, outcome: "sent", template });
    }
  } catch (e) {
    console.error("[wa-blocking-alert] threw:", e instanceof Error ? e.message : String(e));
  }
  return out;
}

/** Sync Graph error path: skip the Zoe Admin number itself so an alert failure can never alert. */
export function shouldAlertForSendFailure(phoneNumberId: string, businessId: number | null, code: unknown): boolean {
  return (
    String(phoneNumberId ?? "").trim() !== MARKETING_WA_PHONE_NUMBER_ID &&
    businessId != null &&
    businessId > 0 &&
    isBusinessBlockingError(code)
  );
}
