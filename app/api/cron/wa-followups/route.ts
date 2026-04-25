import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage } from "@/lib/analytics";
import { sendWhatsAppMessage, resolveTwilioAccountSid, resolveTwilioAuthToken } from "@/lib/whatsapp";
import { resolveCronSecret } from "@/lib/server-env";
import { nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";

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

const T1 =
  "היי! 😊 רציתי לוודא שהכל בסדר - לפעמים ההודעות הולכות לאיבוד, אבל בונדינג חזק נשאר לנצח. ממש אשמח לשמור לך מקום לשיעור ניסיון אם יש בך רצון כזה, או לענות על כל שאלה.";
const T2 =
  "היי, {{bot_name}} כאן 👋 מ{{business_name}}. אני אומנם בוטית ואין לי ממש חיי חברה או עיסוקים, אבל רק מזכירה שאני עוד כאן ממתינה לתשובתך :) יש לך שאלה? אפשר לכתוב לי.";
const T3 =
  "הולה! זו {{bot_name}} מ{{business_name}} 🌟 זו הפעם האחרונה שאני אצור איתך קשר - כי אז יקראו לי חופרת 😊 אם יש בך רצון להתאהב בשגרת האימונים החדשה שלך, אני כאן כדי לגרום לזה לקרות. ואם יש עוד שאלות, תמיד אפשר לשאול אותי כאן או להרים טלפון ישירות למספר {{phone}} אנחנו כאן בשבילך! שיהיה המשך יום קסום.";

async function fetchLatestAssistantMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_id: string;
}): Promise<{ created_at: string; model_used: string | null } | null> {
  const { data } = await input.admin
    .from("messages")
    .select("created_at, model_used, role")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.created_at) return null;
  return { created_at: String(data.created_at), model_used: (data as any).model_used ?? null };
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

      const lastAssist = await fetchLatestAssistantMessageAt({ admin, business_slug, session_id: sessionId });
      if (!lastAssist) {
        skipped += 1;
        continue;
      }

      const lastModel = String(lastAssist.model_used ?? "");
      if (lastModel.startsWith("wa_followup_")) {
        // Prevent looping if our followup was the last assistant message
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
      const stageWanted =
        elapsedMs >= 23 * 60 * 60 * 1000
          ? 3
          : elapsedMs >= 2 * 60 * 60 * 1000
            ? 2
            : elapsedMs >= 20 * 60 * 1000
              ? 1
              : 0;

      if (stageWanted < 1 || stageWanted <= stageCurrent) {
        skipped += 1;
        continue;
      }

      const { data: biz } = await admin
        .from("businesses")
        .select("name, bot_name")
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

      const raw =
        stageWanted === 1 ? T1 : stageWanted === 2 ? fillTemplate(T2, vars) : fillTemplate(T3, vars);
      const body = `${raw}${FOLLOWUP_FOOTER}`;

      await sendWhatsAppMessage(phoneNumberId, phone, body, accountSid, authToken);

      await logMessage({
        business_slug,
        role: "assistant",
        content: body,
        model_used: `wa_followup_${stageWanted}`,
        session_id: sessionId,
      });

      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> = { wa_followup_stage: stageWanted };
      if (stageWanted === 1) patch.wa_followup_1_sent_at = nowIso;
      if (stageWanted === 2) patch.wa_followup_2_sent_at = nowIso;
      if (stageWanted === 3) patch.wa_followup_3_sent_at = nowIso;

      await admin.from("contacts").update(patch).eq("id", (c as any).id);

      sent += 1;
    } catch (e) {
      console.error("[cron/wa-followups] failed:", e);
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, examined, sent, skipped });
}

