import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage } from "@/lib/analytics";
import { isBusinessSubscriptionActive } from "@/lib/notifications/business-notification-eligibility";
import {
  sendWhatsAppIdleFollowupMessage,
  resolveTwilioAccountSid,
  resolveTwilioAuthToken,
} from "@/lib/whatsapp";
import { resolveCronSecret } from "@/lib/server-env";
import { nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import {
  resolveWaSalesFollowupTemplates,
  stripPhonePlaceholderClauseWhenEmpty,
} from "@/lib/wa-sales-followup-defaults";
import { evaluateBusinessWaFollowup } from "@/lib/wa-followup-cron-eval";
import { resolveWaFollowupCta } from "@/lib/wa-followup-cta";
import { customerServicePhoneFromSocialLinks } from "@/lib/whatsapp-copy";
import { contactPhoneLookupVariants, buildWaSessionId, waSessionIdLookupVariants } from "@/lib/phone-normalize";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET כל ~5 דק׳ + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 200;
const FOLLOWUP_FOOTER = "\n\n_לביטול קבלת הודעות שלח *הסר*_";

const MS_20_MIN = 20 * 60 * 1000;
const MS_2_H = 2 * 60 * 60 * 1000;
const MS_23_H = 23 * 60 * 60 * 1000;

type WaFollowupSkipReason =
  | "time_window"
  | "invalid_contact"
  | "no_active_channel"
  | "no_assistant_message"
  | "no_user_message"
  | "no_response"
  | "over_24h"
  | "already_replied"
  | "not_due_yet"
  | "send_failed";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/wa-followups] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function logWaFollowupSkip(
  reason: WaFollowupSkipReason,
  meta: Record<string, unknown>
): void {
  console.info("[cron/wa-followups] skip", { skip_reason: reason, ...meta });
}

function maskPhone(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

const CONTACT_DEBUG_SELECT =
  "id, phone, full_name, wa_no_response_at, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, last_contact_at, opted_out, trial_registered";

async function findContactByPhone(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: string | number,
  phoneInput: string
): Promise<{ row: Record<string, unknown> | null; lookup_variants: string[] }> {
  const lookup_variants = contactPhoneLookupVariants(phoneInput);
  if (!lookup_variants.length) return { row: null, lookup_variants };

  const { data, error } = await admin
    .from("contacts")
    .select(CONTACT_DEBUG_SELECT)
    .eq("business_id", businessId)
    .in("phone", lookup_variants)
    .limit(1);

  if (error) throw error;
  const row = (data?.[0] as Record<string, unknown> | undefined) ?? null;
  return { row, lookup_variants };
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

function notDueYetDetail(stageCurrent: number, elapsedMs: number): Record<string, unknown> {
  if (stageCurrent >= 3) return { wa_followup_stage: stageCurrent, detail: "all_stages_sent" };
  if (stageCurrent < 1) {
    return {
      wa_followup_stage: stageCurrent,
      detail: "waiting_20m",
      elapsed_ms: elapsedMs,
      need_ms: Math.max(0, MS_20_MIN - elapsedMs),
    };
  }
  if (stageCurrent < 2) {
    return {
      wa_followup_stage: stageCurrent,
      detail: "waiting_2h",
      elapsed_ms: elapsedMs,
      need_ms: Math.max(0, MS_2_H - elapsedMs),
    };
  }
  return {
    wa_followup_stage: stageCurrent,
    detail: "waiting_23h",
    elapsed_ms: elapsedMs,
    need_ms: Math.max(0, MS_23_H - elapsedMs),
  };
}

/** Last assistant turn that is not our own WA follow-up (those must not reset the silence clock). */
async function fetchLatestRealAssistantMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<{ created_at: string; model_used: string | null } | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data } = await input.admin
    .from("messages")
    .select("created_at, model_used")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(40);
  for (const row of data ?? []) {
    const m = String((row as { model_used?: string | null }).model_used ?? "");
    if (!m.startsWith("wa_followup_") && row.created_at) {
      return { created_at: String(row.created_at), model_used: m || null };
    }
  }
  return null;
}

async function hasUserReplyAfter(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
  afterIso: string;
}): Promise<boolean> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return false;
  const { data } = await input.admin
    .from("messages")
    .select("id, created_at")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "user")
    .gt("created_at", input.afterIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

async function fetchLatestUserMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<string | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data } = await input.admin
    .from("messages")
    .select("created_at, role")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = data?.created_at ? String(data.created_at) : "";
  return at || null;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const accountSid = resolveTwilioAccountSid();
  const authToken = resolveTwilioAuthToken();
  const admin = createSupabaseAdminClient();

  const debugPhone = req.nextUrl.searchParams.get("debug_phone")?.trim() ?? "";
  const debugSlug = req.nextUrl.searchParams.get("debug_slug")?.trim().toLowerCase() ?? "";
  if (debugPhone && debugSlug) {
    const { data: biz } = await admin.from("businesses").select("id").eq("slug", debugSlug).maybeSingle();
    if (!biz?.id) {
      return NextResponse.json({ ok: false, error: "business_not_found", debug_slug: debugSlug }, { status: 404 });
    }
    let contact: Record<string, unknown> | null = null;
    let phoneLookupVariants: string[] = [];
    try {
      const found = await findContactByPhone(admin, biz.id, debugPhone);
      contact = found.row;
      phoneLookupVariants = found.lookup_variants;
    } catch (contactErr) {
      const message = contactErr instanceof Error ? contactErr.message : String(contactErr);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
    if (!contact) {
      const { data: channel } = await admin
        .from("whatsapp_channels")
        .select("phone_number_id")
        .eq("business_slug", debugSlug)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      const sessionPhoneKey = buildWaSessionId(channel?.phone_number_id ?? "", debugPhone);
      const sessionIds = channel?.phone_number_id
        ? waSessionIdLookupVariants(channel.phone_number_id, debugPhone)
        : [];
      const sessionId = sessionPhoneKey || null;
      let messages_hint: Record<string, unknown> | null = null;
      if (sessionIds.length) {
        const { data: lastUser } = await admin
          .from("messages")
          .select("created_at")
          .eq("business_slug", debugSlug)
          .in("session_id", sessionIds)
          .eq("role", "user")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: lastAssist } = await admin
          .from("messages")
          .select("created_at, model_used")
          .eq("business_slug", debugSlug)
          .in("session_id", sessionIds)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(5);
        const realAssist = (lastAssist ?? []).find(
          (r) => !String((r as { model_used?: string }).model_used ?? "").startsWith("wa_followup_")
        );
        messages_hint = {
          session_id: sessionId,
          session_id_variants: sessionIds,
          last_user_at: lastUser?.created_at ?? null,
          last_assistant_at: realAssist?.created_at ?? null,
        };
      }
      console.info("[cron/wa-followups] skip", {
        skip_reason: "no_contact_row",
        phone: maskPhone(debugPhone),
        business_slug: debugSlug,
        messages_hint,
      });
      return NextResponse.json({
        ok: true,
        debug: true,
        skip_reason: "no_contact_row",
        phone: maskPhone(debugPhone),
        business_slug: debugSlug,
        phone_lookup_variants: phoneLookupVariants,
        note: "contact missing in contacts table — cron batch only includes existing rows",
        messages_hint,
      });
    }
    const contactPhone = String(contact.phone ?? "").trim();
    const evalResult = await evaluateBusinessWaFollowup({
      admin,
      business_slug: debugSlug,
      phone: contactPhone,
      contact: contact as {
        id?: string | number;
        wa_followup_stage?: number | null;
        opted_out?: boolean | null;
        trial_registered?: boolean | null;
      },
    });
    if (evalResult.skip_reason !== "eligible") {
      logWaFollowupSkip(evalResult.skip_reason as WaFollowupSkipReason, {
        phone: maskPhone(debugPhone),
        business_slug: debugSlug,
        contact_id: contact.id,
        ...evalResult.detail,
      });
    }
    const evalBody = Object.fromEntries(Object.entries(evalResult).filter(([key]) => key !== "business_slug"));
    return NextResponse.json({
      ok: true,
      debug: true,
      phone: maskPhone(contactPhone),
      phone_query: maskPhone(debugPhone),
      business_slug: debugSlug,
      contact_id: contact.id,
      trial_registered: contact.trial_registered ?? null,
      opted_out: contact.opted_out ?? null,
      phone_lookup_variants: phoneLookupVariants,
      wa_followup_stage: contact.wa_followup_stage,
      last_contact_at: contact.last_contact_at,
      ...evalBody,
    });
  }

  const now = new Date();
  const allowedAt = nextAllowedWhatsAppSendTimeIsrael(now);
  if (allowedAt.getTime() > now.getTime()) {
    logWaFollowupSkip("time_window", { next_allowed_at: allowedAt.toISOString() });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_send_window",
      skip_reason: "time_window",
      next_allowed_at: allowedAt.toISOString(),
    });
  }

  const nowIso = new Date().toISOString();
  const cutoff24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff20mIso = new Date(Date.now() - MS_20_MIN).toISOString();

  const followupSelect =
    "id, phone, full_name, business_id, wa_no_response_at, wa_next_followup_at, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, opted_out, trial_registered, session_phase";

  let contacts: any[] | null = null;
  const { data: contactsData, error } = await admin
    .from("contacts")
    .select(followupSelect)
    .eq("source", "whatsapp")
    .or("opted_out.eq.false,opted_out.is.null")
    .is("not_relevant_at", null)
    .is("human_requested_at", null)
    .or("trial_registered.eq.false,trial_registered.is.null")
    .lt("wa_followup_stage", 3)
    .not("wa_next_followup_at", "is", null)
    .lte("wa_next_followup_at", nowIso)
    .gte("wa_next_followup_at", cutoff24hIso)
    .limit(BATCH);
  contacts = (contactsData as any[] | null) ?? null;

  if (error) {
    const msg = String(error.message ?? "");
    // Back-compat: if due-at columns are not deployed yet, fall back to last_contact_at window.
    if (/wa_next_followup_at|column/i.test(msg)) {
      const { data: legacy, error: legacyErr } = await admin
        .from("contacts")
        .select(followupSelect)
        .eq("source", "whatsapp")
        .or("opted_out.eq.false,opted_out.is.null")
        .is("not_relevant_at", null)
    .is("human_requested_at", null)
        .or("trial_registered.eq.false,trial_registered.is.null")
        .lt("wa_followup_stage", 3)
        .not("last_contact_at", "is", null)
        .lt("last_contact_at", cutoff20mIso)
        .gte("last_contact_at", cutoff24hIso)
        .limit(BATCH);
      if (legacyErr) {
        console.error("[cron/wa-followups] contacts query (legacy):", legacyErr);
        return NextResponse.json({ error: "query_failed" }, { status: 500 });
      }
      contacts = (legacy as any[] | null) ?? null;
    } else {
      console.error("[cron/wa-followups] contacts query:", error);
      return NextResponse.json({ error: "query_failed" }, { status: 500 });
    }
  } else {
    // לידים עם wa_next_followup_at ריק (לפני backfill / טריגר) — עדיין בתוך חלון 24ש׳ לפי last_contact_at
    const seen = new Set((contacts ?? []).map((c) => String((c as { id?: unknown }).id ?? "")));
    const room = Math.max(0, BATCH - (contacts?.length ?? 0));
    if (room > 0) {
      const { data: nullDueRows, error: nullDueErr } = await admin
        .from("contacts")
        .select(followupSelect)
        .eq("source", "whatsapp")
        .or("opted_out.eq.false,opted_out.is.null")
        .is("not_relevant_at", null)
    .is("human_requested_at", null)
        .or("trial_registered.eq.false,trial_registered.is.null")
        .lt("wa_followup_stage", 3)
        .is("wa_next_followup_at", null)
        .is("wa_no_response_at", null)
        .not("last_contact_at", "is", null)
        .lt("last_contact_at", cutoff20mIso)
        .gte("last_contact_at", cutoff24hIso)
        .limit(room);
      if (nullDueErr) {
        console.warn("[cron/wa-followups] null due-at supplement query:", nullDueErr.message);
      } else {
        for (const row of nullDueRows ?? []) {
          const id = String((row as { id?: unknown }).id ?? "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          contacts = [...(contacts ?? []), row];
        }
      }
    }
  }

  let examined = 0;
  let sent = 0;
  let skipped = 0;
  const skipCounts: Record<string, number> = {};

  const bumpSkip = (reason: WaFollowupSkipReason) => {
    skipped += 1;
    skipCounts[reason] = (skipCounts[reason] ?? 0) + 1;
  };

  for (const c of contacts ?? []) {
    examined += 1;
    const contactId = (c as { id?: string | number }).id;
    const phone = String((c as { phone?: string }).phone ?? "").trim();
    const businessId = (c as { business_id?: number | null }).business_id;
    const noResponseAt = String((c as { wa_no_response_at?: string | null }).wa_no_response_at ?? "").trim();

    if (noResponseAt) {
      logWaFollowupSkip("no_response", {
        contact_id: contactId ?? null,
        phone: phone ? maskPhone(phone) : null,
        business_id: businessId ?? null,
        wa_no_response_at: noResponseAt,
      });
      bumpSkip("no_response");
      continue;
    }

    if (!phone || businessId == null) {
      logWaFollowupSkip("invalid_contact", {
        contact_id: contactId ?? null,
        phone: phone ? maskPhone(phone) : null,
        business_id: businessId ?? null,
      });
      bumpSkip("invalid_contact");
      continue;
    }

    try {
      const { data: channel } = await admin
        .from("whatsapp_channels")
        .select("phone_number_id, business_slug, is_active")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (!channel?.phone_number_id || !channel?.business_slug) {
        logWaFollowupSkip("no_active_channel", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_id: businessId,
        });
        bumpSkip("no_active_channel");
        continue;
      }

      const { data: bizRow } = await admin
        .from("businesses")
        .select("is_active")
        .eq("id", businessId)
        .maybeSingle();
      if (!isBusinessSubscriptionActive((bizRow ?? {}) as { is_active?: boolean | null })) {
        logWaFollowupSkip("no_active_channel", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_id: businessId,
          detail: "business_inactive",
        });
        bumpSkip("no_active_channel");
        continue;
      }

      const business_slug = String(channel.business_slug).trim().toLowerCase();
      const phoneNumberId = String(channel.phone_number_id).trim();
      const sessionId = buildWaSessionId(phoneNumberId, phone);
      const sessionIds = waSessionIdLookupVariants(phoneNumberId, phone);

      const lastAssist = await fetchLatestRealAssistantMessageAt({ admin, business_slug, session_ids: sessionIds });
      if (!lastAssist) {
        logWaFollowupSkip("no_assistant_message", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          session_id_variants: sessionIds,
        });
        bumpSkip("no_assistant_message");
        continue;
      }

      const lastAssistAtIso = lastAssist.created_at;
      if (!lastAssistAtIso) {
        logWaFollowupSkip("no_assistant_message", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          detail: "missing_assistant_timestamp",
        });
        bumpSkip("no_assistant_message");
        continue;
      }

      const lastUserAtIso = await fetchLatestUserMessageAt({ admin, business_slug, session_ids: sessionIds });
      if (!lastUserAtIso) {
        logWaFollowupSkip("no_user_message", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
        });
        bumpSkip("no_user_message");
        continue;
      }

      const hoursSinceUser = (Date.now() - new Date(lastUserAtIso).getTime()) / (1000 * 60 * 60);
      if (!Number.isFinite(hoursSinceUser) || hoursSinceUser >= 24) {
        logWaFollowupSkip("over_24h", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          hours_since_user: hoursSinceUser,
          last_user_at: lastUserAtIso,
        });
        bumpSkip("over_24h");
        continue;
      }

      if (await hasUserReplyAfter({ admin, business_slug, session_ids: sessionIds, afterIso: lastAssistAtIso })) {
        logWaFollowupSkip("already_replied", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          last_assistant_at: lastAssistAtIso,
        });
        bumpSkip("already_replied");
        continue;
      }

      const elapsedMs = Date.now() - new Date(lastAssistAtIso).getTime();
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        logWaFollowupSkip("not_due_yet", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          detail: "invalid_elapsed",
          elapsed_ms: elapsedMs,
          last_assistant_at: lastAssistAtIso,
        });
        bumpSkip("not_due_yet");
        continue;
      }

      const stageCurrent = Number((c as { wa_followup_stage?: number | null }).wa_followup_stage ?? 0) || 0;
      const nextStage =
        stageCurrent < 1 && elapsedMs >= MS_20_MIN
          ? 1
          : stageCurrent < 2 && elapsedMs >= MS_2_H
            ? 2
            : stageCurrent < 3 && elapsedMs >= MS_23_H
              ? 3
              : 0;

      if (nextStage < 1) {
        logWaFollowupSkip("not_due_yet", {
          contact_id: contactId,
          phone: maskPhone(phone),
          business_slug,
          session_id: sessionId,
          last_assistant_at: lastAssistAtIso,
          last_assistant_model: lastAssist.model_used,
          ...notDueYetDetail(stageCurrent, elapsedMs),
        });
        bumpSkip("not_due_yet");
        continue;
      }

      const { data: biz } = await admin
        .from("businesses")
        .select("name, bot_name, social_links")
        .eq("id", businessId)
        .maybeSingle();
      const businessName = String((biz as { name?: string }).name ?? "").trim() || business_slug;
      const botName = String((biz as { bot_name?: string }).bot_name ?? "").trim() || "זואי";
      // מספר שירות הלקוחות של העסק (טאב «על העסק») — לא מספר הוואטסאפ של זואי (phone_display)
      const csPhone = customerServicePhoneFromSocialLinks((biz as { social_links?: unknown }).social_links);

      const vars = {
        bot_name: botName,
        business_name: businessName,
        phone: csPhone || "",
        service_phone_note: csPhone ? `\n\nניתן גם להתקשר ל:${csPhone}` : "",
      };

      const { t1, t2, t3 } = resolveWaSalesFollowupTemplates((biz as { social_links?: unknown }).social_links);
      let chosenTemplate = nextStage === 1 ? t1 : nextStage === 2 ? t2 : t3;
      // אין מספר שירות לקוחות → להשמיט את פסוקית הטלפון במקום משפט קטוע
      if (!csPhone) chosenTemplate = stripPhonePlaceholderClauseWhenEmpty(chosenTemplate);
      const raw = fillTemplate(chosenTemplate, vars);
      const bodyCore = raw.trim();
      const sessionPhase = String((c as { session_phase?: string | null }).session_phase ?? "").trim();
      const cta = await resolveWaFollowupCta({
        admin,
        businessId: Number(businessId),
        business_slug,
        session_ids: sessionIds,
        social_links: (biz as { social_links?: unknown }).social_links,
        session_phase: sessionPhase || null,
      });

      await sendWhatsAppIdleFollowupMessage(
        phoneNumberId,
        phone,
        bodyCore,
        FOLLOWUP_FOOTER,
        cta,
        accountSid,
        authToken
      );

      let logContent = `${bodyCore}${FOLLOWUP_FOOTER}`;
      if (cta?.mode === "url") logContent += `\n\n[כפתור: ${cta.label} → ${cta.url}]`;
      else if (cta?.mode === "reply") logContent += `\n\n[כפתור תשובה: ${cta.label}]`;

      await logMessage({
        business_slug,
        role: "assistant",
        content: logContent,
        model_used: `wa_followup_${nextStage}`,
        session_id: sessionId,
      });

      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> = { wa_followup_stage: nextStage };
      if (nextStage === 1) patch.wa_followup_1_sent_at = nowIso;
      if (nextStage === 2) patch.wa_followup_2_sent_at = nowIso;
      if (nextStage === 3) patch.wa_followup_3_sent_at = nowIso;

      await admin.from("contacts").update(patch).eq("id", contactId);

      if (nextStage === 3) {
        const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
        void dispatchCrmEvent({
          businessId: Number(businessId),
          leadPhone: phone,
          kind: "no_response",
          fullName: String((c as { full_name?: string | null }).full_name ?? "").trim() || null,
          eventAtIso: nowIso,
        });
      }

      sent += 1;
    } catch (e) {
      console.error("[cron/wa-followups] failed:", e);
      logWaFollowupSkip("send_failed", {
        contact_id: contactId,
        phone: maskPhone(phone),
        business_id: businessId,
        error: e instanceof Error ? e.message : String(e),
      });
      bumpSkip("send_failed");
    }
  }

  return NextResponse.json({ ok: true, examined, sent, skipped, skip_counts: skipCounts });
}
