import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveCronSecret } from "@/lib/server-env";
import { sendEmail, whatsappReadyEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildTag() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  return sha ? sha.slice(0, 7) : "";
}

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/wa-provision] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function twilioAuthHeader(accountSid: string, authToken: string) {
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  return `Basic ${basic}`;
}

function normalizeE164(s: string) {
  return String(s ?? "").trim().replace(/\s+/g, "");
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isIlTelAvivLandline(e164: string): boolean {
  const n = normalizeE164(e164);
  return n.startsWith("+9723") || n.startsWith("+972-3") || n.startsWith("+972 3");
}

function parseMonthlyUsd(row: any): number | null {
  const direct =
    typeof row?.monthly_cost === "number"
      ? row.monthly_cost
      : typeof row?.price === "number"
        ? row.price
        : typeof row?.cost === "number"
          ? row.cost
          : null;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const s = String(row?.monthly_cost ?? row?.price ?? row?.cost ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function twilioFetchJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: URLSearchParams | null; debugLabel?: string }
) {
  if (opts.debugLabel) {
    console.info(`[cron/wa-provision] twilio request (${opts.debugLabel}):`, {
      method: opts.method || "GET",
      url,
      hasBody: Boolean(opts.body),
    });
  }
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      ...(opts.headers || {}),
      ...(opts.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: opts.body ? opts.body.toString() : undefined,
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (opts.debugLabel) {
    const count =
      Array.isArray(json?.recordings) ? json.recordings.length :
      Array.isArray(json?.transcriptions) ? json.transcriptions.length :
      null;
    console.info(`[cron/wa-provision] twilio response (${opts.debugLabel}):`, {
      status: res.status,
      ok: res.ok,
      count,
      body: json ?? text,
    });
  }
  if (!res.ok) {
    const msg = (json && (json.message || json.error_message)) || text || `twilio_failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function metaFetchJson(
  url: string,
  token: string,
  body: Record<string, any>,
  debug?: { label: string; includeOk?: boolean }
) {
  if (debug?.label) {
    console.info(`[cron/wa-provision] meta request (${debug.label}):`, { url, body });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (debug?.label && (debug.includeOk || !res.ok)) {
    console.info(`[cron/wa-provision] meta response (${debug.label}):`, {
      status: res.status,
      ok: res.ok,
      text,
      json,
    });
  }
  if (!res.ok) {
    const msg = (json && (json.error?.message || json.message)) || text || `meta_failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

function stripCc972(e164: string) {
  const clean = String(e164 || "").trim().replace(/\s+/g, "");
  if (clean.startsWith("+972")) return clean.slice(4);
  if (clean.startsWith("972")) return clean.slice(3);
  return clean.replace(/^\+/, "");
}

function isoNow() {
  return new Date().toISOString();
}

function msSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

function extract6DigitCode(s: string) {
  const m = String(s ?? "").match(/\b\d{6}\b/);
  return m?.[0] ?? "";
}

function utcDateOnly(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

const TRANSCRIPTION_WAIT_MS = 2 * 60_000;

export async function GET(req: NextRequest) {
  const build = buildTag();
  if (!authorizeCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const whatsappSystemToken = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  const metaWabaId = process.env.META_WABA_ID?.trim() ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const supabaseHost = (() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).host : "";
    } catch {
      return "";
    }
  })();
  if (!twilioAccountSid || !twilioAuthToken || !whatsappSystemToken || !metaWabaId) {
    return NextResponse.json({ error: "missing_env", build }, { status: 500 });
  }

  const admin = createSupabaseAdminClient();

  // We prefer selecting "non-terminal" jobs rather than exact status matching.
  // This makes the worker resilient to accidental whitespace/casing issues in `status`.
  const terminalStatuses = ["done", "failed"] as const;

  const diagBase = {
    build,
    supabaseHost,
    hasServiceRoleKey,
  };

  // Pick one job to progress (avoid long waits inside a single invocation).
  const { data: job } = await admin
    .from("wa_provision_jobs")
    .select(
      "id, business_id, business_slug, business_name, attempts, status, updated_at, phone_e164, meta_phone_number_id, twilio_sid, recording_sid, transcription_started_at, transcription_polls"
    )
    .neq("status", "done")
    .neq("status", "failed")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!job?.id) {
    const { count, error } = await admin
      .from("wa_provision_jobs")
      .select("id", { count: "exact", head: true })
      .neq("status", "done")
      .neq("status", "failed");

    const { data: sample } = await admin
      .from("wa_provision_jobs")
      .select("id,status,updated_at,last_error")
      .order("created_at", { ascending: true })
      .limit(5);
    return NextResponse.json(
      {
        ok: true,
        processed: 0,
        ...diagBase,
        diag: {
          selectable_count: count ?? null,
          selectable_count_error: error?.message ?? null,
          sample: (sample ?? []).map((r: any) => ({
            id: Number(r.id),
            status: String(r.status ?? ""),
            updated_at: String(r.updated_at ?? ""),
            last_error: String(r.last_error ?? ""),
          })),
        },
      },
      { status: 200 }
    );
  }

  // Lock it optimistically. For queued jobs, bump to running so we don't double-purchase.
  const initialStatus = String((job as any).status ?? "queued");
  const { data: locked } = await admin
    .from("wa_provision_jobs")
    .update({
      ...(initialStatus === "queued" ? { status: "running" } : {}),
      attempts: Number((job as any).attempts ?? 0) + 1,
      updated_at: isoNow(),
    } as any)
    .eq("id", Number(job.id))
    .eq("status", initialStatus)
    .select(
      "id, business_id, business_slug, business_name, attempts, status, updated_at, phone_e164, meta_phone_number_id, twilio_sid, recording_sid, transcription_started_at, transcription_polls"
    )
    .maybeSingle();

  if (!locked?.id) return NextResponse.json({ ok: true, processed: 0, raced: true, build });

  const twilioAuth = twilioAuthHeader(twilioAccountSid, twilioAuthToken);
  const twimlVoiceUrl = "https://handler.twilio.com/twiml/EH3a2831d7f10a000887d9678027077ad9";
  const metaBusinessId = metaWabaId;

  let phoneE164 = "";
  let twilioSid = "";
  let metaPhoneNumberId = "";
  let recordingSid = String((locked as any).recording_sid ?? "").trim();
  let transcriptionStartedAt = (locked as any).transcription_started_at ? String((locked as any).transcription_started_at) : "";
  let transcriptionPolls = Number((locked as any).transcription_polls ?? 0) || 0;
  const businessSlug = String((locked as any).business_slug ?? "").trim().toLowerCase();
  let verifiedName = "";
  try {
    const { data: biz } = await admin
      .from("businesses")
      .select("name")
      .eq("id", Number((locked as any).business_id))
      .maybeSingle();
    verifiedName = String((biz as any)?.name ?? "").trim();
  } catch {
    verifiedName = "";
  }
  if (!verifiedName) {
    verifiedName =
      String((locked as any).business_name ?? "").trim() ||
      businessSlug ||
      "HeyZoe";
  }

  try {
    const status = String((locked as any).status ?? "queued");
    console.info("[cron/wa-provision] job:", {
      id: Number((locked as any).id),
      status,
      business_slug: businessSlug,
      phone_e164: String((locked as any).phone_e164 ?? ""),
      meta_phone_number_id: String((locked as any).meta_phone_number_id ?? ""),
      twilio_sid: String((locked as any).twilio_sid ?? ""),
      recording_sid: recordingSid,
    });

    // If we already have Meta + Twilio state, never re-purchase/re-register.
    const existingMetaId = String((locked as any).meta_phone_number_id ?? "").trim();
    const existingPhone = String((locked as any).phone_e164 ?? "").trim();
    const existingTwilioSid = String((locked as any).twilio_sid ?? "").trim();
    if (status === "running" && existingMetaId && existingPhone && existingTwilioSid) {
      console.warn("[cron/wa-provision] job has meta id already; skipping purchase and continuing to waiting_recording", {
        id: Number((locked as any).id),
        meta_phone_number_id: existingMetaId,
      });
      const { error } = await admin
        .from("wa_provision_jobs")
        .update({ status: "waiting_recording", updated_at: isoNow() } as any)
        .eq("id", Number(locked.id));
      if (error) throw error;
      return NextResponse.json({ ok: true, processed: 1, status: "waiting_recording", build });
    }

    // If we previously fell back to manual code but we *do* have a recording_sid,
    // we can attempt the transcription flow automatically.
    if (status === "awaiting_manual_code") {
      const existingRecordingSid = String((locked as any).recording_sid ?? "").trim();
      if (existingMetaId && existingPhone && existingTwilioSid && existingRecordingSid) {
        const { error } = await admin
          .from("wa_provision_jobs")
          .update({ status: "transcribing", updated_at: isoNow() } as any)
          .eq("id", Number(locked.id));
        if (error) throw error;
        // Continue in the same invocation as transcribing.
        (locked as any).status = "transcribing";
        recordingSid = existingRecordingSid;
      } else {
        // Still needs manual intervention.
        return NextResponse.json({ ok: true, processed: 1, status: "awaiting_manual_code", build });
      }
    }

    if (status === "waiting_recording" || status === "transcribing") {
      phoneE164 = String((locked as any).phone_e164 ?? "").trim();
      metaPhoneNumberId = String((locked as any).meta_phone_number_id ?? "").trim();
      twilioSid = String((locked as any).twilio_sid ?? "").trim();

      // Self-heal: if progress fields are missing, try to hydrate from whatsapp_channels.
      if (!phoneE164 || !metaPhoneNumberId || !twilioSid) {
        try {
          const bid = Number((locked as any).business_id);
          const slug = String((locked as any).business_slug ?? "").trim().toLowerCase();
          const { data: ch } = await admin
            .from("whatsapp_channels")
            .select("phone_display, phone_number_id, twilio_sid, business_id, business_slug")
            .or(`business_id.eq.${bid},business_slug.eq.${slug}`)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const hydratedPhone = String((ch as any)?.phone_display ?? "").trim();
          const hydratedMeta = String((ch as any)?.phone_number_id ?? "").trim();
          const hydratedTwilio = String((ch as any)?.twilio_sid ?? "").trim();
          if (hydratedPhone || hydratedMeta || hydratedTwilio) {
            phoneE164 = phoneE164 || hydratedPhone;
            metaPhoneNumberId = metaPhoneNumberId || hydratedMeta;
            twilioSid = twilioSid || hydratedTwilio;
            const { error } = await admin
              .from("wa_provision_jobs")
              .update(
                {
                  updated_at: isoNow(),
                  ...(phoneE164 ? { phone_e164: phoneE164 } : {}),
                  ...(metaPhoneNumberId ? { meta_phone_number_id: metaPhoneNumberId } : {}),
                  ...(twilioSid ? { twilio_sid: twilioSid } : {}),
                } as any
              )
              .eq("id", Number(locked.id));
            if (error) throw error;
            console.info("[cron/wa-provision] hydrated missing progress fields from whatsapp_channels", {
              id: Number((locked as any).id),
              phone_e164: Boolean(phoneE164),
              meta_phone_number_id: Boolean(metaPhoneNumberId),
              twilio_sid: Boolean(twilioSid),
            });
          }
        } catch (err) {
          console.warn("[cron/wa-provision] hydration attempt failed:", err);
        }
      }

      if (!phoneE164 || !metaPhoneNumberId || !twilioSid) {
        throw new Error("missing_state_for_progress");
      }
    }

    if (status === "waiting_recording") {
      // Try to fetch recording (no sleeping in-function).
      const dateOnly = utcDateOnly();
      const recordingsUrl =
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
        `/Recordings.json?To=${encodeURIComponent(phoneE164)}&PageSize=3&DateCreated%3E%3D=${encodeURIComponent(dateOnly)}`;
      const rec = await twilioFetchJson(recordingsUrl, {
        headers: { Authorization: twilioAuth },
        body: null,
        debugLabel: "recordings_list",
      });
      const list = Array.isArray(rec?.recordings) ? rec.recordings : [];
      const rec0 = list[0] ?? null;
      recordingSid = String(rec0?.sid ?? "").trim();
      const recordingStatus = String(rec0?.status ?? "").trim().toLowerCase();
      console.info("[cron/wa-provision] twilio recordings pick:", {
        to: phoneE164,
        dateCreatedGte: dateOnly,
        picked_recording_sid: recordingSid || null,
        picked_created_at: rec0?.date_created ?? null,
        picked_status: rec0?.status ?? null,
      });

      if (!recordingSid) {
        // Still waiting. After ~5 minutes, fallback to manual code.
        const waitedMs = msSince(String((locked as any).updated_at ?? ""));
        if (waitedMs > 5 * 60_000) {
          const { error } = await admin
            .from("wa_provision_jobs")
            .update({
              status: "awaiting_manual_code",
              updated_at: isoNow(),
              phone_e164: phoneE164,
              meta_phone_number_id: metaPhoneNumberId,
              twilio_sid: twilioSid,
              last_error: "recording_not_found_timeout",
            } as any)
            .eq("id", Number(locked.id));
          if (error) throw error;
          return NextResponse.json({ ok: true, processed: 1, status: "awaiting_manual_code", build });
        }

        const { error } = await admin
          .from("wa_provision_jobs")
          .update({ status: "waiting_recording", updated_at: isoNow() } as any)
          .eq("id", Number(locked.id));
        if (error) throw error;
        return NextResponse.json({ ok: true, processed: 1, status: "waiting_recording", build });
      }

      // TwiML now uses transcribe="true", so only advance when recording is completed.
      // If Twilio reports "absent" (or anything non-completed), keep waiting for next cron tick.
      if (recordingStatus !== "completed") {
        const { error } = await admin
          .from("wa_provision_jobs")
          .update({
            status: "waiting_recording",
            updated_at: isoNow(),
            recording_sid: recordingSid,
            phone_e164: phoneE164,
            meta_phone_number_id: metaPhoneNumberId,
            twilio_sid: twilioSid,
          } as any)
          .eq("id", Number(locked.id));
        if (error) throw error;
        return NextResponse.json({
          ok: true,
          processed: 1,
          status: "waiting_recording",
          build,
          recording_status: recordingStatus || "unknown",
        });
      }

      // Persist recording SID immediately (defense-in-depth: even if next update fails).
      {
        const { error } = await admin
          .from("wa_provision_jobs")
          .update({ recording_sid: recordingSid, updated_at: isoNow() } as any)
          .eq("id", Number(locked.id));
        if (error) {
          console.error("[cron/wa-provision] failed to persist recording_sid:", { id: Number(locked.id), error });
          throw error;
        }
      }

      const { error: txErr } = await admin
        .from("wa_provision_jobs")
        .update({
          status: "transcribing",
          updated_at: isoNow(),
          recording_sid: recordingSid,
          transcription_started_at: isoNow(),
          transcription_polls: 0,
          phone_e164: phoneE164,
          meta_phone_number_id: metaPhoneNumberId,
          twilio_sid: twilioSid,
        } as any)
        .eq("id", Number(locked.id));
      if (txErr) throw txErr;

      return NextResponse.json({ ok: true, processed: 1, status: "transcribing", build });
    }

    if (status === "transcribing") {
      if (!recordingSid) {
        throw new Error("missing_recording_sid");
      }
      const listTxUrl =
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
        `/Recordings/${encodeURIComponent(recordingSid)}/Transcriptions.json`;
      console.info("[cron/wa-provision] twilio transcription fetch:", { url: listTxUrl, recording_sid: recordingSid });
      const txList = await twilioFetchJson(listTxUrl, { headers: { Authorization: twilioAuth }, body: null });
      const t0 = Array.isArray(txList?.transcriptions) ? txList.transcriptions[0] : null;
      const text = String(t0?.transcription_text ?? "").trim();
      const txStatus = String(t0?.status ?? "").trim().toLowerCase();
      console.info("[cron/wa-provision] twilio transcription result:", {
        transcription_sid: t0?.sid ?? null,
        status: t0?.status ?? null,
        has_text: Boolean(text),
        text_preview: text ? text.slice(0, 120) : "",
      });
      if (text) {
        console.info("[cron/wa-provision] twilio transcription text:", text);
      }

      // If transcription is still running, retry on next cron tick (max 3 polls).
      const inProgress =
        txStatus === "in-progress" ||
        txStatus === "queued" ||
        txStatus === "processing" ||
        txStatus === "running";
      const completed = txStatus === "completed" || txStatus === "completed-successfully" || txStatus === "completed_successfully";
      // If Twilio returns an explicit status that's not completed yet (and no text), wait for next cron tick.
      const shouldWait = (inProgress || (txStatus && !completed)) && !text;
      if (shouldWait) {
        if (transcriptionPolls >= 2) {
          const { error } = await admin
            .from("wa_provision_jobs")
            .update({
              status: "awaiting_manual_code",
              updated_at: isoNow(),
              last_error: "transcription_not_completed_3_polls",
              phone_e164: phoneE164,
              meta_phone_number_id: metaPhoneNumberId,
              twilio_sid: twilioSid,
              recording_sid: recordingSid,
            } as any)
            .eq("id", Number(locked.id));
          if (error) throw error;
          return NextResponse.json({ ok: true, processed: 1, status: "awaiting_manual_code", build });
        }
        const { error } = await admin
          .from("wa_provision_jobs")
          .update({ status: "transcribing", updated_at: isoNow(), transcription_polls: transcriptionPolls + 1 } as any)
          .eq("id", Number(locked.id));
        if (error) throw error;
        return NextResponse.json({ ok: true, processed: 1, status: "transcribing", build });
      }
      if (inProgress) {
        if (transcriptionPolls >= 2) {
          const { error } = await admin
            .from("wa_provision_jobs")
            .update({
              status: "awaiting_manual_code",
              updated_at: isoNow(),
              last_error: "transcription_in_progress_3_polls",
              phone_e164: phoneE164,
              meta_phone_number_id: metaPhoneNumberId,
              twilio_sid: twilioSid,
              recording_sid: recordingSid,
            } as any)
            .eq("id", Number(locked.id));
          if (error) throw error;
          return NextResponse.json({ ok: true, processed: 1, status: "awaiting_manual_code", build });
        }
        const { error } = await admin
          .from("wa_provision_jobs")
          .update({ status: "transcribing", updated_at: isoNow(), transcription_polls: transcriptionPolls + 1 } as any)
          .eq("id", Number(locked.id));
        if (error) throw error;
        return NextResponse.json({ ok: true, processed: 1, status: "transcribing", build });
      }

      const code = extract6DigitCode(text);
      if (!code) {
        const startedIso = transcriptionStartedAt || String((locked as any).transcription_started_at ?? "");
        const waitedMs = msSince(startedIso);
        if (waitedMs > TRANSCRIPTION_WAIT_MS) {
          const { error } = await admin
            .from("wa_provision_jobs")
            .update({
              status: "awaiting_manual_code",
              updated_at: isoNow(),
              last_error: "transcription_timeout_or_no_code",
              phone_e164: phoneE164,
              meta_phone_number_id: metaPhoneNumberId,
              twilio_sid: twilioSid,
              recording_sid: recordingSid,
            } as any)
            .eq("id", Number(locked.id));
          if (error) throw error;
          return NextResponse.json({ ok: true, processed: 1, status: "awaiting_manual_code", build });
        }

        const { error } = await admin
          .from("wa_provision_jobs")
          .update({ status: "transcribing", updated_at: isoNow() } as any)
          .eq("id", Number(locked.id));
        if (error) throw error;
        return NextResponse.json({ ok: true, processed: 1, status: "transcribing", build });
      }

      // Verify in Meta
      const verifyUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/verify_code`;
      await metaFetchJson(verifyUrl, whatsappSystemToken, { code }, { label: "verify_code", includeOk: true });

      // Save active
      await admin
        .from("whatsapp_channels")
        .update({ is_active: true, provisioning_status: "active" } as any)
        .eq("phone_number_id", metaPhoneNumberId);

      await admin
        .from("businesses")
        .update({ whatsapp_number: phoneE164 } as any)
        .eq("id", (locked as any).business_id);

      // Email customer (best-effort)
      try {
        const { data: biz } = await admin
          .from("businesses")
          .select("name,email,slug,whatsapp_number")
          .eq("id", (locked as any).business_id)
          .maybeSingle();
        const to = String((biz as any)?.email ?? "").trim().toLowerCase();
        const businessName = String((biz as any)?.name ?? (locked as any)?.business_name ?? "").trim() || String((locked as any).business_slug ?? "");
        const whatsappNumber = String((biz as any)?.whatsapp_number ?? phoneE164 ?? "").trim();
        if (to) {
          const tpl = whatsappReadyEmail(businessName, whatsappNumber);
          await sendEmail({ to, subject: tpl.subject, htmlContent: tpl.htmlContent });
        }
      } catch (e) {
        console.error("[cron/wa-provision] customer email failed:", e);
      }

      const { error: doneErr } = await admin
        .from("wa_provision_jobs")
        .update({
          status: "done",
          updated_at: isoNow(),
          phone_e164: phoneE164,
          meta_phone_number_id: metaPhoneNumberId,
          twilio_sid: twilioSid,
          recording_sid: recordingSid,
        } as any)
        .eq("id", Number(locked.id));
      if (doneErr) throw doneErr;

      return NextResponse.json({ ok: true, processed: 1, status: "done", phone: phoneE164, build });
    }

    if (status !== "running") {
      // Unknown/unsupported status for this worker loop.
      throw new Error(`unsupported_status:${status}`);
    }

    // Step 1: reuse existing Twilio number if provided; otherwise search + purchase
    const existingPhoneE164 = String((locked as any).phone_e164 ?? "").trim();
    const existingJobTwilioSid = String((locked as any).twilio_sid ?? "").trim();
    if (existingPhoneE164 && existingJobTwilioSid) {
      phoneE164 = existingPhoneE164;
      twilioSid = existingJobTwilioSid;
      console.info("[cron/wa-provision] reuse existing Twilio number (skip purchase):", {
        id: Number((locked as any).id),
        phone_e164: phoneE164,
        twilio_sid: twilioSid,
      });
    } else {
      const availableUrl =
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
        "/AvailablePhoneNumbers/IL/Local.json?VoiceEnabled=true&ExcludeAllAddressRequired=true&ExcludeLocalAddressRequired=true&ExcludeForeignAddressRequired=true&Beta=false&Contains=%2B9723*&PageSize=20";
      const avail = await twilioFetchJson(availableUrl, { headers: { Authorization: twilioAuth }, body: null });
      const list = Array.isArray(avail?.available_phone_numbers) ? avail.available_phone_numbers : [];
      const picked =
        list.find(
          (r: any) =>
            isIlTelAvivLandline(String(r?.phone_number ?? "")) &&
            (parseMonthlyUsd(r) ?? 0) <= 10 &&
            (parseMonthlyUsd(r) ?? 0) > 0
        ) ||
        list.find((r: any) => isIlTelAvivLandline(String(r?.phone_number ?? ""))) ||
        null;
      const phone_number = String(picked?.phone_number ?? "").trim();
      if (!phone_number) throw new Error("no_available_numbers");

      const buyUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/IncomingPhoneNumbers.json`;
      const buy = await twilioFetchJson(buyUrl, {
        method: "POST",
        headers: { Authorization: twilioAuth },
        body: new URLSearchParams({ PhoneNumber: phone_number }),
      });
      twilioSid = String(buy?.sid ?? "").trim();
      phoneE164 = String(buy?.phone_number ?? phone_number).trim();
      if (!twilioSid) throw new Error("twilio_purchase_missing_sid");
    }

    // Step 2: TwiML
    const updateUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}` +
      `/IncomingPhoneNumbers/${encodeURIComponent(twilioSid)}.json`;
    await twilioFetchJson(updateUrl, {
      method: "POST",
      headers: { Authorization: twilioAuth },
      body: new URLSearchParams({ VoiceUrl: twimlVoiceUrl }),
    });

    // Step 3: Meta Cloud API registration
    // Use the Cloud API registration flow (type=CLOUD_API) rather than "migration".
    const metaRegUrl = `https://graph.facebook.com/v19.0/${metaBusinessId}/phone_numbers`;
    const metaReg = await metaFetchJson(
      metaRegUrl,
      whatsappSystemToken,
      {
      cc: "972",
      phone_number: stripCc972(phoneE164),
      verified_name: verifiedName,
      type: "CLOUD_API",
      },
      { label: "register_phone_number", includeOk: true }
    );
    metaPhoneNumberId = String(metaReg?.id ?? metaReg?.phone_number_id ?? "").trim();
    if (!metaPhoneNumberId) throw new Error("meta_register_missing_id");

    // Persist pending channel as soon as we have Meta ID
    await admin
      .from("whatsapp_channels")
      .upsert(
        {
          business_id: (locked as any).business_id,
          business_slug: String((locked as any).business_slug ?? "").trim().toLowerCase(),
          phone_number_id: metaPhoneNumberId,
          phone_display: phoneE164,
          is_active: false,
          twilio_sid: twilioSid,
          provisioning_status: "pending",
        } as any,
        { onConflict: "phone_number_id" }
      );

    // Step 4: request OTP voice code from Meta
    const metaRequestCodeUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/request_code`;
    await metaFetchJson(
      metaRequestCodeUrl,
      whatsappSystemToken,
      { code_method: "VOICE", language: "he" },
      { label: "request_code", includeOk: true }
    );

    // Persist and continue in next cron invocation (avoid sleeping in this request).
    const { error: waitErr } = await admin
      .from("wa_provision_jobs")
      .update({
        status: "waiting_recording",
        updated_at: isoNow(),
        phone_e164: phoneE164,
        meta_phone_number_id: metaPhoneNumberId,
        twilio_sid: twilioSid,
        recording_sid: null,
        transcription_started_at: null,
        transcription_polls: 0,
      } as any)
      .eq("id", Number(locked.id));
    if (waitErr) throw waitErr;

    return NextResponse.json({ ok: true, processed: 1, status: "waiting_recording", build });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Avoid clobbering persisted progress fields with NULLs.
    const lockedPhone = String((locked as any)?.phone_e164 ?? "").trim();
    const lockedMeta = String((locked as any)?.meta_phone_number_id ?? "").trim();
    const lockedTwilio = String((locked as any)?.twilio_sid ?? "").trim();
    const lockedRecording = String((locked as any)?.recording_sid ?? "").trim();
    const lockedStatus = String((locked as any)?.status ?? "").trim();
    const missingState =
      msg === "missing_state_for_progress"
        ? {
            status: lockedStatus,
            missing: {
              phone_e164: !(phoneE164 || lockedPhone),
              meta_phone_number_id: !(metaPhoneNumberId || lockedMeta),
              twilio_sid: !(twilioSid || lockedTwilio),
              recording_sid: lockedStatus === "transcribing" || lockedStatus === "awaiting_manual_code"
                ? !(recordingSid || lockedRecording)
                : false,
            },
            seen: {
              phone_e164: phoneE164 || lockedPhone || null,
              meta_phone_number_id: metaPhoneNumberId || lockedMeta || null,
              twilio_sid: twilioSid || lockedTwilio || null,
              recording_sid: recordingSid || lockedRecording || null,
            },
          }
        : null;

    // Best-effort persist failure state
    if (metaPhoneNumberId) {
      await admin
        .from("whatsapp_channels")
        .upsert(
          {
            business_id: (locked as any).business_id,
            business_slug: String((locked as any).business_slug ?? "").trim().toLowerCase(),
            phone_number_id: metaPhoneNumberId,
            phone_display: phoneE164 || null,
            is_active: false,
            twilio_sid: twilioSid || null,
            provisioning_status: "failed",
          } as any,
          { onConflict: "phone_number_id" }
        );
    }

    await admin
      .from("wa_provision_jobs")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
        last_error: msg,
        phone_e164: (phoneE164 || lockedPhone) || null,
        meta_phone_number_id: (metaPhoneNumberId || lockedMeta) || null,
        twilio_sid: (twilioSid || lockedTwilio) || null,
      } as any)
      .eq("id", Number(locked.id));

    // Email business on failure (best-effort)
    try {
      const { data: biz } = await admin
        .from("businesses")
        .select("name,slug,email")
        .eq("id", (locked as any).business_id)
        .maybeSingle();
      const businessName = String((biz as any)?.name ?? (locked as any)?.business_name ?? "").trim() || String((locked as any).business_slug ?? "");
      const slug = String((biz as any)?.slug ?? (locked as any)?.business_slug ?? "").trim().toLowerCase();
      const to = String((biz as any)?.email ?? "").trim().toLowerCase();
      if (to) {
        await sendEmail({
          to,
          subject: `⚠️ פרוויז'ן נכשל - ${businessName}`,
          htmlContent: [
            `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif">`,
            `<p><b>פרוויז'ן נכשל</b></p>`,
            `<p><b>עסק:</b> ${businessName}</p>`,
            `<p><b>slug:</b> ${slug}</p>`,
            `<p><b>שגיאה:</b> ${String(msg).replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`,
            `<p><b>Twilio SID:</b> ${twilioSid || "-"}</p>`,
            `<p><b>Meta phone_number_id:</b> ${metaPhoneNumberId || "-"}</p>`,
            `<p><b>Phone:</b> ${phoneE164 || "-"}</p>`,
            `</div>`,
          ].join(""),
        });
      }
    } catch (err) {
      console.error("[cron/wa-provision] failure email failed:", err);
    }

    return NextResponse.json({
      ok: true,
      processed: 1,
      status: "failed",
      build,
      error: msg,
      ...(missingState ? { missing_state: missingState } : {}),
    });
  }
}

