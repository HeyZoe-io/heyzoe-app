import { NextRequest, NextResponse } from "next/server";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { logMessage } from "@/lib/analytics";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import {
  decideScheduledSendAfterMeta,
  decideScheduledSendGate,
  isDuePendingScheduledSend,
  NO_TEMPLATE_SKIPPED_ERROR,
  type ScheduledTemplateSendRow,
} from "@/lib/scheduled-template-sends";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { canonicalizeTriggerType } from "@/lib/template-trigger-types";
import {
  expiryYmdFromScheduledDedupKey,
  templateSendPayload,
  triggerTypeFromScheduledDedupKey,
} from "@/lib/template-send-params";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET + Authorization: Bearer CRON_SECRET.
 *  גם שוטף scheduled_marketing_template_sends (תזכורות/שידורים של קו זואי אדמין).
 *  מומלץ כל שעה — IO: שאילתה לפי אינדקס (status, due_at), לא סריקת טבלה. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 200;

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn(
      "[cron/scheduled-template-sends] CRON_SECRET not set — allowing request in dev only"
    );
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

type DispatchMark =
  | { status: "sent" }
  | { status: "failed"; last_error: string }
  | { status: "canceled"; last_error: string };

async function markScheduledSend(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  mark: DispatchMark
): Promise<void> {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: mark.status,
    updated_at: nowIso,
    last_error: mark.status === "sent" ? null : mark.last_error,
  };
  const { error } = await admin
    .from("scheduled_template_sends")
    .update(patch)
    .eq("id", id)
    .eq("status", "pending");
  if (error) {
    console.error("[cron/scheduled-template-sends] status update failed:", error.message, {
      id,
      status: mark.status,
    });
  }
}

async function lookupContactFullName(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  phone: string
): Promise<string | null> {
  const variants = contactPhoneLookupVariants(phone);
  const { data } = await admin
    .from("contacts")
    .select("full_name, last_contact_at")
    .eq("business_id", businessId)
    .in("phone", variants.length ? variants : [phone])
    .order("last_contact_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const name = String((data as { full_name?: string | null } | null)?.full_name ?? "").trim();
  return name || null;
}

/**
 * Same gating as the immediate purchase template path (channel + WABA + APPROVED template).
 * Not sendable at due time → canceled (no late retry). Transient Meta error → failed.
 */
async function dispatchOneScheduledSend(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  row: ScheduledTemplateSendRow
): Promise<"sent" | "failed" | "canceled" | "skipped"> {
  if (!isDuePendingScheduledSend(row)) return "skipped";

  const businessId = Number(row.business_id);
  const phone = String(row.contact_phone ?? "").trim();
  const templateName = String(row.template_name ?? "").trim();
  if (!businessId || !phone || !templateName) {
    await markScheduledSend(admin, row.id, {
      status: "canceled",
      last_error: NO_TEMPLATE_SKIPPED_ERROR,
    });
    return "canceled";
  }

  const channel = await resolveSendChannelForContact(admin, businessId, phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();

  const [{ data: bizRow }, { data: approvedTpl }, { data: triggerRow }] = await Promise.all([
    admin.from("businesses").select("slug, waba_id, name").eq("id", businessId).maybeSingle(),
    admin
      .from("whatsapp_templates")
      .select("id, status, language, components")
      .eq("business_id", businessId)
      .eq("name", templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
    admin
      .from("template_triggers")
      .select("trigger_type")
      .eq("id", row.trigger_id)
      .maybeSingle(),
  ]);

  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");

  const gate = decideScheduledSendGate({
    hasChannel: Boolean(phoneNumberId),
    hasWaba: Boolean(wabaId),
    hasApprovedTemplate: Boolean(approvedTpl?.id),
  });

  if (gate.action === "cancel") {
    await markScheduledSend(admin, row.id, {
      status: "canceled",
      last_error: gate.last_error,
    });
    return "canceled";
  }

  const fullName = await lookupContactFullName(admin, businessId, phone);
  const firstName = firstNameFromFullName(String(fullName ?? ""));
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const triggerType = canonicalizeTriggerType(
    String((triggerRow as { trigger_type?: unknown } | null)?.trigger_type ?? "").trim() ||
      triggerTypeFromScheduledDedupKey(row.dedup_key) ||
      ""
  );
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType,
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    expiryDateYmd: expiryYmdFromScheduledDedupKey(row.dedup_key),
  });

  const sendResult = await sendBusinessTemplate({
    to: phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  const afterMeta = decideScheduledSendAfterMeta({
    ok: sendResult.ok,
    error: sendResult.error,
  });

  if (afterMeta.status === "failed") {
    await markScheduledSend(admin, row.id, {
      status: "failed",
      last_error: afterMeta.last_error,
    });
    return "failed";
  }

  await markScheduledSend(admin, row.id, { status: "sent" });

  const businessSlug = String((bizRow as { slug?: unknown } | null)?.slug ?? "")
    .trim()
    .toLowerCase();
  if (businessSlug) {
    const sessionId = buildWaSessionId(phoneNumberId, phone);
    await logMessage({
      business_slug: businessSlug,
      role: "assistant",
      content: formatLeadTemplateMessageContent(templateName, {
        firstName,
        components: storedComponents,
        bodyParams,
      }),
      model_used: LEAD_TEMPLATE_MODEL,
      session_id: sessionId,
    });
  }

  return "sent";
}

/**
 * Due-processing for delayed template_triggers (status=pending AND due_at <= now).
 * Index-backed on (status, due_at); batch capped at BATCH_LIMIT.
 * Scheduling: external cron-job.org (not Vercel crons).
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/scheduled-template-sends] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ranAt = new Date().toISOString();
  const nowIso = ranAt;
  const admin = createSupabaseAdminClient();

  try {
    const { data, error } = await admin
      .from("scheduled_template_sends")
      .select(
        "id, business_id, trigger_id, contact_phone, template_name, due_at, status, dedup_key, last_error, created_at, updated_at"
      )
      .eq("status", "pending")
      .lte("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) {
      console.error("[cron/scheduled-template-sends] select failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as ScheduledTemplateSendRow[];
    let sent = 0;
    let failed = 0;
    let canceled = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const outcome = await dispatchOneScheduledSend(admin, row);
        if (outcome === "sent") sent += 1;
        else if (outcome === "failed") failed += 1;
        else if (outcome === "canceled") canceled += 1;
        else skipped += 1;
      } catch (e) {
        failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        console.error("[cron/scheduled-template-sends] row threw:", message, { id: row.id });
        await markScheduledSend(admin, row.id, {
          status: "failed",
          last_error: message.slice(0, 500),
        });
      }
    }

    let marketing_fetched = 0;
    let marketing_sent = 0;
    let marketing_failed = 0;
    let marketing_canceled = 0;
    try {
      const { data: mktRows, error: mktErr } = await admin
        .from("scheduled_marketing_template_sends")
        .select(
          "id, trigger_id, contact_phone, template_name, due_at, status, dedup_key, body_params, last_error, created_at, updated_at"
        )
        .eq("status", "pending")
        .lte("due_at", nowIso)
        .order("due_at", { ascending: true })
        .limit(BATCH_LIMIT);
      if (mktErr) {
        if (!/does not exist|schema cache|scheduled_marketing_template_sends/i.test(mktErr.message)) {
          console.error("[cron/scheduled-template-sends] marketing select failed:", mktErr.message);
        }
      } else {
        const { dispatchDueMarketingScheduledSend } = await import("@/lib/marketing-template-dispatch");
        const pending = (mktRows ?? []) as import("@/lib/scheduled-marketing-template-sends").ScheduledMarketingTemplateSendRow[];
        marketing_fetched = pending.length;
        for (const row of pending) {
          try {
            const outcome = await dispatchDueMarketingScheduledSend(admin, row);
            if (outcome === "sent") marketing_sent += 1;
            else if (outcome === "failed") marketing_failed += 1;
            else marketing_canceled += 1;
          } catch (e) {
            marketing_failed += 1;
            const message = e instanceof Error ? e.message : String(e);
            console.error("[cron/scheduled-template-sends] marketing row threw:", message, {
              id: row.id,
            });
          }
        }
      }
    } catch (e) {
      console.error("[cron/scheduled-template-sends] marketing flush failed:", e);
    }

    console.info("[cron/scheduled-template-sends] done", {
      ran_at: ranAt,
      fetched: rows.length,
      sent,
      failed,
      canceled,
      skipped,
      marketing_fetched,
      marketing_sent,
      marketing_failed,
      marketing_canceled,
      batch_limit: BATCH_LIMIT,
    });

    return NextResponse.json({
      ok: true,
      ran_at: ranAt,
      fetched: rows.length,
      sent,
      failed,
      canceled,
      skipped,
      marketing_fetched,
      marketing_sent,
      marketing_failed,
      marketing_canceled,
      batch_limit: BATCH_LIMIT,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/scheduled-template-sends] unexpected error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
