import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage } from "@/lib/analytics";
import { sendWhatsAppMessage, resolveTwilioAccountSid, resolveTwilioAuthToken } from "@/lib/whatsapp";
import { resolveCronSecret } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOLLOWUP_FOOTER = "\n\n_לביטול קבלת הודעות שלח *הסר*_";
const DEFAULT_CORE = "היי! רצינו לבדוק אם יש לך שאלות נוספות 😊";
const HOURS = 24;
const BATCH = 100;

function buildFollowupBody(ctaText: string, ctaLink: string): string {
  const t = ctaText.trim();
  const l = ctaLink.trim();
  let core: string;
  if (t && l) {
    core = `${t}\n${l}`;
  } else if (t) {
    core = t;
  } else if (l) {
    core = l;
  } else {
    core = DEFAULT_CORE;
  }
  return `${core}${FOLLOWUP_FOOTER}`;
}

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    console.warn("[cron/followup] CRON_SECRET not set — allowing request (set CRON_SECRET in production)");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accountSid = resolveTwilioAccountSid();
  const authToken = resolveTwilioAuthToken();

  const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000).toISOString();
  const admin = createSupabaseAdminClient();

  const { data: contacts, error: contactsErr } = await admin
    .from("contacts")
    .select("id, phone, business_id, last_contact_at")
    .eq("followup_sent", false)
    .or("opted_out.eq.false,opted_out.is.null")
    .not("last_contact_at", "is", null)
    .lt("last_contact_at", cutoff)
    .eq("source", "whatsapp")
    .limit(BATCH);

  if (contactsErr) {
    console.error("[cron/followup] contacts query:", contactsErr);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  let examined = 0;
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of contacts ?? []) {
    examined += 1;
    const phone = String(row.phone ?? "").trim();
    const businessId = row.business_id;
    if (!phone || businessId == null) {
      skipped += 1;
      continue;
    }

    try {
      const { data: channel, error: chErr } = await admin
        .from("whatsapp_channels")
        .select("phone_number_id, business_slug")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (chErr || !channel?.phone_number_id || !channel.business_slug) {
        skipped += 1;
        continue;
      }

      const businessSlug = String(channel.business_slug);
      const phoneNumberId = String(channel.phone_number_id);
      const sessionId = `wa_${phoneNumberId}_${phone}`;

      const nowIso = new Date().toISOString();
      const { data: paused } = await admin
        .from("paused_sessions")
        .select("id")
        .eq("business_slug", businessSlug)
        .eq("session_id", sessionId)
        .gt("paused_until", nowIso)
        .maybeSingle();
      if (paused) {
        skipped += 1;
        continue;
      }

      const { data: lastMsg, error: lastErr } = await admin
        .from("messages")
        .select("role, created_at, model_used")
        .eq("business_slug", businessSlug)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastErr || !lastMsg) {
        skipped += 1;
        continue;
      }

      if (lastMsg.role !== "assistant") {
        skipped += 1;
        continue;
      }

      if (String(lastMsg.model_used ?? "") === "inactive_followup_cron") {
        skipped += 1;
        continue;
      }

      const lastAt = String(lastMsg.created_at ?? "");
      if (!lastAt || lastAt >= cutoff) {
        skipped += 1;
        continue;
      }

      const { count: userCount, error: ucErr } = await admin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("business_slug", businessSlug)
        .eq("session_id", sessionId)
        .eq("role", "user");

      if (ucErr || !userCount || userCount < 1) {
        skipped += 1;
        continue;
      }

      const { data: biz, error: bizErr } = await admin
        .from("businesses")
        .select("cta_text, cta_link")
        .eq("id", businessId)
        .maybeSingle();

      if (bizErr) {
        errors.push(`biz ${businessId}`);
        skipped += 1;
        continue;
      }

      const body = buildFollowupBody(
        String((biz as { cta_text?: string })?.cta_text ?? ""),
        String((biz as { cta_link?: string })?.cta_link ?? "")
      );

      await sendWhatsAppMessage(phoneNumberId, phone, body, accountSid, authToken);

      await logMessage({
        business_slug: businessSlug,
        role: "assistant",
        content: body,
        model_used: "inactive_followup_cron",
        session_id: sessionId,
      });

      const { error: upErr } = await admin
        .from("contacts")
        .update({ followup_sent: true })
        .eq("id", row.id);

      if (upErr) {
        console.error("[cron/followup] failed to set followup_sent:", upErr);
        errors.push(`update ${row.id}`);
      } else {
        sent += 1;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cron/followup] contact loop:", row.id, msg);
      errors.push(msg);
      skipped += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    examined,
    sent,
    skipped,
    errors: errors.slice(0, 12),
  });
}
