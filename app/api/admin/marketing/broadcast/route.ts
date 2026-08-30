import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import {
  dispatchDueMarketingScheduledSend,
  enqueueMarketingBroadcast,
} from "@/lib/marketing-template-dispatch";
import { toPipelineDateOnly } from "@/lib/marketing-next-call";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import type { ScheduledMarketingTemplateSendRow } from "@/lib/scheduled-marketing-template-sends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INLINE_FLUSH_LIMIT = 20;
const AUDIENCES = ["all", "completed", "upcoming_call"] as const;
type Audience = (typeof AUDIENCES)[number];

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const, admin: createSupabaseAdminClient() };
}

function isAudience(v: string): v is Audience {
  return (AUDIENCES as readonly string[]).includes(v);
}

/**
 * POST /api/admin/marketing/broadcast
 * Body: { audience, template_name, send: "now" | "schedule", schedule_at?: ISO }
 *
 * Immediate: enqueue due_at=now + flush up to 20 in this request.
 * Rest wait for cron-job.org → /api/cron/scheduled-template-sends.
 * Meta cost: 1 Graph call per recipient.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { admin } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const audience = String(body.audience ?? "").trim();
  if (!isAudience(audience)) {
    return NextResponse.json({ error: "invalid_audience" }, { status: 400 });
  }
  const templateName = String(body.template_name ?? "").trim();
  if (!templateName) {
    return NextResponse.json({ error: "missing_template_name" }, { status: 400 });
  }

  const { data: tpl, error: tplErr } = await admin
    .from("marketing_whatsapp_templates")
    .select("id, status, disabled")
    .eq("name", templateName)
    .eq("disabled", false)
    .limit(1)
    .maybeSingle();
  if (tplErr) {
    console.error("[admin/marketing/broadcast] template lookup failed:", tplErr.message);
    return NextResponse.json({ error: "template_lookup_failed" }, { status: 500 });
  }
  const status = String((tpl as { status?: unknown } | null)?.status ?? "").toUpperCase();
  if (!tpl?.id || status !== "APPROVED") {
    return NextResponse.json({ error: "template_not_approved" }, { status: 400 });
  }

  const sendMode = String(body.send ?? "now").trim() === "schedule" ? "schedule" : "now";
  let dueAt = new Date();
  if (sendMode === "schedule") {
    const raw = String(body.schedule_at ?? "").trim();
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) {
      const date = toPipelineDateOnly(body.schedule_date);
      const time = String(body.schedule_time ?? "08:00").trim();
      if (!date) {
        return NextResponse.json({ error: "invalid_schedule_at" }, { status: 400 });
      }
      dueAt = israelWallTimeToUtc(date, time);
    } else {
      dueAt = new Date(parsed);
    }
    if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "invalid_schedule_at" }, { status: 400 });
    }
  }

  let query = admin.from("marketing_flow_sessions").select("phone, flow_completed, next_call_at");
  if (audience === "completed") query = query.eq("flow_completed", true);
  if (audience === "upcoming_call") {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    query = query.gte("next_call_at", today);
  }

  const { data: sessions, error: sessErr } = await query.limit(5000);
  if (sessErr) {
    console.error("[admin/marketing/broadcast] sessions lookup failed:", sessErr.message);
    return NextResponse.json({ error: "audience_lookup_failed" }, { status: 500 });
  }

  const phones = [...new Set((sessions ?? []).map((r) => String((r as { phone?: unknown }).phone ?? "").trim()).filter(Boolean))];
  if (phones.length === 0) {
    return NextResponse.json({ ok: true, recipients: 0, queued: 0, flushed: 0 });
  }

  const batchId = crypto.randomUUID();
  const { queued, errors } = await enqueueMarketingBroadcast({
    phones,
    templateName,
    dueAt: sendMode === "now" ? new Date() : dueAt,
    batchId,
  });

  let flushed = 0;
  if (sendMode === "now" && queued > 0) {
    const { data: dueRows, error: dueErr } = await admin
      .from("scheduled_marketing_template_sends")
      .select(
        "id, trigger_id, contact_phone, template_name, due_at, status, dedup_key, body_params, last_error, created_at, updated_at"
      )
      .eq("status", "pending")
      .like("dedup_key", `broadcast:${batchId}:%`)
      .order("due_at", { ascending: true })
      .limit(INLINE_FLUSH_LIMIT);
    if (dueErr) {
      console.error("[admin/marketing/broadcast] flush select failed:", dueErr.message);
    } else {
      for (const row of (dueRows ?? []) as ScheduledMarketingTemplateSendRow[]) {
        try {
          const outcome = await dispatchDueMarketingScheduledSend(admin, row);
          if (outcome === "sent") flushed += 1;
        } catch (e) {
          console.error("[admin/marketing/broadcast] flush row failed:", e);
        }
      }
    }
  }

  console.info("[admin/marketing/broadcast] queued", {
    audience,
    templateName,
    recipients: phones.length,
    queued,
    errors,
    flushed,
    sendMode,
  });

  return NextResponse.json({
    ok: true,
    recipients: phones.length,
    queued,
    errors,
    flushed,
    remaining: Math.max(0, queued - flushed),
    batch_id: batchId,
  });
}
