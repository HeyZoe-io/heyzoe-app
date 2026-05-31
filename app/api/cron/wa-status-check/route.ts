import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { waSessionPhoneKey } from "@/lib/phone-normalize";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET כל ~5 דק׳ + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 200;
const NO_RESPONSE_AFTER_MS = 26 * 60 * 60 * 1000;

type ChannelRow = {
  phone_number_id: string | null;
  business_slug: string | null;
};

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/wa-status-check] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function maskPhone(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cutoffIso = new Date(now - NO_RESPONSE_AFTER_MS).toISOString();
  const channelByBusinessId = new Map<number, ChannelRow | null>();

  const statusSelect = "id, phone, business_id, session_phase, wa_no_response_due_at";

  let contacts: any[] | null = null;
  const { data: contactsData, error } = await admin
    .from("contacts")
    .select(statusSelect)
    .eq("source", "whatsapp")
    .or("opted_out.eq.false,opted_out.is.null")
    .or("trial_registered.eq.false,trial_registered.is.null")
    .is("wa_no_response_at", null)
    .not("wa_no_response_due_at", "is", null)
    .lt("wa_no_response_due_at", nowIso)
    .limit(BATCH);
  contacts = (contactsData as any[] | null) ?? null;

  if (error) {
    if (/wa_no_response_at|column/i.test(String(error.message ?? ""))) {
      return NextResponse.json({ ok: true, skipped: true, reason: "columns_missing" });
    }
    const msg = String(error.message ?? "");
    // Back-compat: if due-at column is not deployed yet, fall back to last_contact_at cutoff.
    if (/wa_no_response_due_at|column/i.test(msg)) {
      const { data: legacy, error: legacyErr } = await admin
        .from("contacts")
        .select("id, phone, business_id, session_phase")
        .eq("source", "whatsapp")
        .or("opted_out.eq.false,opted_out.is.null")
        .or("trial_registered.eq.false,trial_registered.is.null")
        .is("wa_no_response_at", null)
        .not("last_contact_at", "is", null)
        .lt("last_contact_at", cutoffIso)
        .limit(BATCH);
      if (legacyErr) {
        console.error("[cron/wa-status-check] contacts query (legacy):", legacyErr);
        return NextResponse.json({ error: "query_failed" }, { status: 500 });
      }
      contacts = (legacy as any[] | null) ?? null;
    } else {
      console.error("[cron/wa-status-check] contacts query:", error);
      return NextResponse.json({ error: "query_failed" }, { status: 500 });
    }
  } else {
    const seen = new Set((contacts ?? []).map((c) => String((c as { id?: unknown }).id ?? "")));
    const room = Math.max(0, BATCH - (contacts?.length ?? 0));
    if (room > 0) {
      const { data: nullDueRows, error: nullDueErr } = await admin
        .from("contacts")
        .select(statusSelect)
        .eq("source", "whatsapp")
        .or("opted_out.eq.false,opted_out.is.null")
        .or("trial_registered.eq.false,trial_registered.is.null")
        .is("wa_no_response_at", null)
        .is("wa_no_response_due_at", null)
        .not("last_contact_at", "is", null)
        .lt("last_contact_at", cutoffIso)
        .limit(room);
      if (nullDueErr) {
        console.warn("[cron/wa-status-check] null due-at supplement query:", nullDueErr.message);
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
  let marked = 0;
  let skipped = 0;
  const skipCounts: Record<string, number> = {};

  const bumpSkip = (reason: string) => {
    skipped += 1;
    skipCounts[reason] = (skipCounts[reason] ?? 0) + 1;
  };

  for (const row of contacts ?? []) {
    examined += 1;
    const contact = row as {
      id?: string | number;
      phone?: string | null;
      business_id?: number | null;
      session_phase?: string | null;
    };
    const contactId = contact.id;
    const phone = String(contact.phone ?? "").trim();
    const businessId = Number(contact.business_id);

    if (!contactId || !phone || !Number.isFinite(businessId) || businessId <= 0) {
      bumpSkip("invalid_contact");
      continue;
    }
    if (String(contact.session_phase ?? "").trim() === "registered") {
      bumpSkip("registered");
      continue;
    }

    try {
      if (!channelByBusinessId.has(businessId)) {
        const { data: channel } = await admin
          .from("whatsapp_channels")
          .select("phone_number_id, business_slug")
          .eq("business_id", businessId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        channelByBusinessId.set(businessId, (channel as ChannelRow | null) ?? null);
      }

      const channel = channelByBusinessId.get(businessId);
      const phoneNumberId = String(channel?.phone_number_id ?? "").trim();
      const businessSlug = String(channel?.business_slug ?? "").trim().toLowerCase();
      if (!phoneNumberId || !businessSlug) {
        bumpSkip("no_active_channel");
        continue;
      }

      const sessionId = `wa_${phoneNumberId}_${waSessionPhoneKey(phone)}`;
      const { data: lastMsg, error: msgErr } = await admin
        .from("messages")
        .select("role, created_at")
        .eq("business_slug", businessSlug)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (msgErr || !lastMsg) {
        bumpSkip("no_message");
        continue;
      }

      const role = String((lastMsg as { role?: string }).role ?? "");
      const createdAt = String((lastMsg as { created_at?: string }).created_at ?? "");
      if (role !== "assistant") {
        bumpSkip("last_message_not_bot");
        continue;
      }

      const lastBotAtMs = new Date(createdAt).getTime();
      if (!Number.isFinite(lastBotAtMs) || now - lastBotAtMs < NO_RESPONSE_AFTER_MS) {
        bumpSkip("not_due_yet");
        continue;
      }

      const { error: updateErr } = await admin
        .from("contacts")
        .update({ wa_no_response_at: nowIso })
        .eq("id", contactId)
        .is("wa_no_response_at", null);

      if (updateErr) {
        console.error("[cron/wa-status-check] mark failed:", {
          contact_id: contactId,
          phone: maskPhone(phone),
          error: updateErr.message,
        });
        bumpSkip("update_failed");
        continue;
      }

      marked += 1;
    } catch (e) {
      console.error("[cron/wa-status-check] contact loop:", {
        contact_id: contactId,
        phone: maskPhone(phone),
        error: e instanceof Error ? e.message : String(e),
      });
      bumpSkip("exception");
    }
  }

  return NextResponse.json({ ok: true, examined, marked, skipped, skip_counts: skipCounts });
}
