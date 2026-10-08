/**
 * Zoe Admin WhatsApp to Lior when sends are held: one message right after each PLAN that
 * held anything, and one when the circuit breaker pauses a trigger.
 * Template zoe_admin_sends_held (UTILITY, {{1}} total, {{2}} details, {{3}} link). Until it is
 * APPROVED in marketing_whatsapp_templates, zoe_admin_daily_unsent carries the text.
 * Cost: at most 2 PLAN alerts a day, plus one per breaker trip.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ADMIN_SUPPORT_ALERT_WHATSAPP, sendAdminWhatsAppTemplate } from "@/lib/notifications/sendAdminWhatsAppTemplate";
import { logMarketingWhatsAppMessage } from "@/lib/marketing-whatsapp";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const SENDS_HELD_TEMPLATE = "zoe_admin_sends_held";
const FALLBACK_TEMPLATE = "zoe_admin_daily_unsent";
export const SENDS_HELD_MODEL = "send_plan_held_alert";

export const HOLD_REASON_LABELS: Record<string, string> = {
  empty_variable: "משתנה ריק",
  relative_words: "מילת זמן לא תואמת",
  volume_anomaly: "נפח חריג",
  waba_blocked: "חסימת וואטסאפ",
  circuit_breaker: "מפסק נפח",
  plan_write_failed: "שגיאת כתיבה",
};

export function heldDashboardUrl(): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://heyzoe.io")
    .trim()
    .replace(/\/$/, "");
  return `${site}/admin/held-sends`;
}

export type HeldCount = { business: string; reason: string; count: number };

/** "Apex: 12 נפח חריג, 1 משתנה ריק · Tights: 3 מילת זמן לא תואמת". One line, Meta rejects newlines in params. */
export function renderHeldDetails(rows: readonly HeldCount[]): { total: number; details: string } {
  const byBusiness = new Map<string, Array<{ reason: string; count: number }>>();
  let total = 0;
  for (const row of rows) {
    if (row.count <= 0) continue;
    total += row.count;
    const list = byBusiness.get(row.business) ?? [];
    list.push({ reason: row.reason, count: row.count });
    byBusiness.set(row.business, list);
  }
  const parts = [...byBusiness.entries()].map(
    ([business, list]) =>
      `${business}: ${list.map((r) => `${r.count} ${HOLD_REASON_LABELS[r.reason] ?? r.reason}`).join(", ")}`
  );
  return { total, details: parts.join(" · ").replace(/\s+/g, " ").slice(0, 900) };
}

let templateCache: { approved: boolean; at: number } | null = null;

async function dedicatedApproved(admin: Admin): Promise<boolean> {
  if (templateCache && Date.now() - templateCache.at < 10 * 60_000) return templateCache.approved;
  const { data, error } = await admin
    .from("marketing_whatsapp_templates")
    .select("status, disabled")
    .eq("name", SENDS_HELD_TEMPLATE)
    .eq("language", "he")
    .limit(1);
  if (error) console.error("[send-plan] held template status read failed:", error.message);
  const row = (data?.[0] ?? null) as { status?: unknown; disabled?: unknown } | null;
  const approved = String(row?.status ?? "").toUpperCase() === "APPROVED" && row?.disabled !== true;
  templateCache = { approved, at: Date.now() };
  return approved;
}

export type HeldAlertSend = typeof sendAdminWhatsAppTemplate;

/** Never throws. Returns the template used, or the error. */
export async function sendHeldAlert(input: {
  admin: Admin;
  headline: string;
  rows: readonly HeldCount[];
  send?: HeldAlertSend;
}): Promise<{ ok: boolean; template?: string; error?: string; skipped?: boolean }> {
  try {
    const { total, details } = renderHeldDetails(input.rows);
    if (!total) return { ok: true, skipped: true };
    const link = heldDashboardUrl();
    const dedicated = await dedicatedApproved(input.admin);
    const template = dedicated ? SENDS_HELD_TEMPLATE : FALLBACK_TEMPLATE;
    const text = `${input.headline}: ${total} הודעות מוחזקות. ${details}. לשחרור או ביטול: ${link}`;
    const bodyParams = dedicated ? [String(total), `${input.headline}. ${details}`, link] : [String(total), text];
    const sent = await (input.send ?? sendAdminWhatsAppTemplate)({
      to: ADMIN_SUPPORT_ALERT_WHATSAPP,
      templateName: template,
      languageCode: "he",
      bodyParams,
    });
    if (!sent.ok) {
      console.error("[send-plan] held alert send failed", { template, error: sent.error });
      return { ok: false, template, error: sent.error };
    }
    await logMarketingWhatsAppMessage({
      leadPhone: ADMIN_SUPPORT_ALERT_WHATSAPP,
      role: "assistant",
      content: text,
      model_used: SENDS_HELD_MODEL,
    }).catch((e) => console.error("[send-plan] held alert log failed:", e instanceof Error ? e.message : e));
    return { ok: true, template };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[send-plan] held alert threw:", message);
    return { ok: false, error: message };
  }
}
