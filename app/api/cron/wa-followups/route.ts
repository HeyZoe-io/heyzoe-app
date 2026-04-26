import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage } from "@/lib/analytics";
import { sendWhatsAppMessage, resolveTwilioAccountSid, resolveTwilioAuthToken } from "@/lib/whatsapp";
import { resolveCronSecret } from "@/lib/server-env";
import { nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import { resolveWaSalesFollowupTemplates } from "@/lib/wa-sales-followup-defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
 
const BATCH = 200;
const FOLLOWUP_FOOTER = "\n\n_לביטול קבלת הודעות שלח *הסר*_";

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

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

/** Last assistant turn that is not our own WA follow-up (those must not reset the silence clock). */
async function fetchLatestRealAssistantMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_id: string;
}): Promise<{ created_at: string; model_used: string | null } | null> {
  const { data } = await input.admin
    .from("messages")
    .select("created_at, model_used")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
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
  session_id: string;
  afterIso: string;
}): Promise<boolean> {
  const { data } = await input.admin
    .from("messages")
    .select("id, created_at")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
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
  session_id: string;
}): Promise<string | null> {
  const { data } = await input.admin
    .from("messages")
    .select("created_at, role")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
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

  const now = new Date();
  const allowedAt = nextAllowedWhatsAppSendTimeIsrael(now);
  if (allowedAt.getTime() > now.getTime()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_send_window",
      next_allowed_at: allowedAt.toISOString(),
    });
  }

  const { data: contacts, error } = await admin
    .from("contacts")
    .select(
      "id, phone, business_id, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, opted_out, trial_registered"
    )
    .eq("source", "whatsapp")
    .or("opted_out.eq.false,opted_out.is.null")
    .or("trial_registered.eq.false,trial_registered.is.null")
    .limit(BATCH);

  if (error) {
    console.error("[cron/wa-followups] contacts query:", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  let examined = 0;
  let sent = 0;
  let skipped = 0;

  for (const c of contacts ?? []) {
    examined += 1;
    const phone = String((c as any).phone ?? "").trim();
    const businessId = (c as any).business_id;
    if (!phone || businessId == null) {
      skipped += 1;
      continue;
    }

    try {
      const { data: channel } = await admin
        .from("whatsapp_channels")
        .select("phone_number_id, business_slug, phone_display, is_active")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (!channel?.phone_number_id || !channel?.business_slug) {
        skipped += 1;
        continue;
      }

      const business_slug = String(channel.business_slug).trim().toLowerCase();
      const phoneNumberId = String(channel.phone_number_id).trim();
      const sessionId = `wa_${phoneNumberId}_${phone}`;

      const lastAssist = await fetchLatestRealAssistantMessageAt({ admin, business_slug, session_id: sessionId });
      if (!lastAssist) {
        skipped += 1;
        continue;
      }

      const lastAssistAtIso = lastAssist.created_at;
      if (!lastAssistAtIso) {
        skipped += 1;
        continue;
      }

      // Meta 24h rule: do not send any non-template messages >24h after the user's last message.
      const lastUserAtIso = await fetchLatestUserMessageAt({ admin, business_slug, session_id: sessionId });
      if (!lastUserAtIso) {
        skipped += 1;
        continue;
      }
      const hoursSinceUser = (Date.now() - new Date(lastUserAtIso).getTime()) / (1000 * 60 * 60);
      if (!Number.isFinite(hoursSinceUser) || hoursSinceUser >= 24) {
        skipped += 1;
        continue;
      }

      if (await hasUserReplyAfter({ admin, business_slug, session_id: sessionId, afterIso: lastAssistAtIso })) {
        skipped += 1;
        continue;
      }

      const elapsedMs = Date.now() - new Date(lastAssistAtIso).getTime();
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        skipped += 1;
        continue;
      }

      const stageCurrent = Number((c as any).wa_followup_stage ?? 0) || 0;
      const nextStage =
        stageCurrent < 1 && elapsedMs >= 20 * 60 * 1000
          ? 1
          : stageCurrent < 2 && elapsedMs >= 2 * 60 * 60 * 1000
            ? 2
            : stageCurrent < 3 && elapsedMs >= 23 * 60 * 60 * 1000
              ? 3
              : 0;

      if (nextStage < 1) {
        skipped += 1;
        continue;
      }

      const { data: biz } = await admin
        .from("businesses")
        .select("name, bot_name, social_links")
        .eq("id", businessId)
        .maybeSingle();
      const businessName = String((biz as any)?.name ?? "").trim() || business_slug;
      const botName = String((biz as any)?.bot_name ?? "").trim() || "זואי";
      const phoneDisplay = String((channel as any)?.phone_display ?? "").trim();

      const vars = {
        bot_name: botName,
        business_name: businessName,
        phone: phoneDisplay || "",
      };

      const { t1, t2, t3 } = resolveWaSalesFollowupTemplates((biz as any)?.social_links);
      const raw =
        nextStage === 1
          ? fillTemplate(t1, vars)
          : nextStage === 2
            ? fillTemplate(t2, vars)
            : fillTemplate(t3, vars);
      const body = `${raw}${FOLLOWUP_FOOTER}`;

      await sendWhatsAppMessage(phoneNumberId, phone, body, accountSid, authToken);

      await logMessage({
        business_slug,
        role: "assistant",
        content: body,
        model_used: `wa_followup_${nextStage}`,
        session_id: sessionId,
      });

      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> = { wa_followup_stage: nextStage };
      if (nextStage === 1) patch.wa_followup_1_sent_at = nowIso;
      if (nextStage === 2) patch.wa_followup_2_sent_at = nowIso;
      if (nextStage === 3) patch.wa_followup_3_sent_at = nowIso;

      await admin.from("contacts").update(patch).eq("id", (c as any).id);

      sent += 1;
    } catch (e) {
      console.error("[cron/wa-followups] failed:", e);
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, examined, sent, skipped });
}

