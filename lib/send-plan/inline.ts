/**
 * Event-driven sends (15-minute and hourly crons, incoming leads): no planning, the same
 * per-item checks inline right before the Graph call, plus a circuit breaker.
 * Empty variables, opt-out and the 20h duplicate claim already run in sendBusinessTemplate.
 * Here: staff / leave request (retention triggers), relative day words, blocked WABA, an
 * admin-canceled hold, and the breaker (more than 3x the normal volume of that hour pauses the
 * trigger for the business until the end of the day; the rest is held; Lior is alerted once).
 *
 * A held send is written to scheduled_template_sends (status held, plan_slot event) and
 * returns sends_hold, so the caller releases its claim and the next run asks again. Release
 * on the admin page sends it; cancel makes the next run close the event as skipped.
 *
 * IO per send: one held-row read, one pause read, one hourly count; contact read only for
 * retention triggers; template, trigger type, business and WABA reads cached per instance.
 */
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { lookupBusinessIdByPhoneNumberId } from "@/lib/contact-alert-mute";
import { templateClaimEventKey } from "@/lib/notifications/template-send-claim";
import { normalizePhone } from "@/lib/phone-normalize";
import { DUPLICATE_GUARD_ERROR } from "@/lib/notifications/template-duplicate-guard";
import { renderWhatsAppTemplatePreview } from "@/lib/wa-zoe-admin-template-log";
import { canonicalizeTriggerType } from "@/lib/template-trigger-types";
import { triggerTypeFromScheduledDedupKey } from "@/lib/template-send-params";
import { triggerSkipsStaff } from "@/lib/leads/arbox-staff";
import {
  eventMetaFromDedupKey,
  eventStartInstant,
  HOLD_REASONS,
  hourlyAverage,
  israelWallInstant,
  LEAVE_REQUEST_TRIGGERS,
  planDayOf,
  planEventKey,
  planRowDedupKey,
  relativeWordMismatch,
  SEND_CHECK_SKIPPED_ERROR,
  SKIP_REASONS,
  tripsBreaker,
  breakerLimit,
} from "@/lib/send-plan/checks";
import {
  countSendsSince,
  emptyPlanReadCache,
  loadContactCheck,
  loadLoggedTemplateSends,
  loadSendHistory,
  loadTemplateMeta,
  loadTriggerType,
  loadWabaBlocked,
  type PlanReadCache,
} from "@/lib/send-plan/data";
import { sendHeldAlert } from "@/lib/send-plan/alerts";
import { addCalendarDaysYmd } from "@/lib/rule-activation";
import type { PlanSendInput } from "@/lib/send-plan/types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const SENDS_HOLD_GATE_ERROR = "sends_hold";
export const ADMIN_CANCELED_REASON = "canceled_by_admin";

const CACHE_MS = 5 * 60_000;
let cache: { at: number; reads: PlanReadCache } = { at: 0, reads: emptyPlanReadCache() };
const businessByPhoneId = new Map<string, { id: number | null; at: number }>();
const baselineCache = new Map<string, { avg: number; at: number }>();

function reads(): PlanReadCache {
  if (Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), reads: emptyPlanReadCache() };
  return cache.reads;
}

export function resetEventSendGateCache(): void {
  cache = { at: 0, reads: emptyPlanReadCache() };
  businessByPhoneId.clear();
  baselineCache.clear();
  slugByBusiness.clear();
}

async function businessIdFor(admin: Admin, phoneNumberId: string): Promise<number | null> {
  const hit = businessByPhoneId.get(phoneNumberId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.id;
  const id = await lookupBusinessIdByPhoneNumberId(admin, phoneNumberId);
  businessByPhoneId.set(phoneNumberId, { id, at: Date.now() });
  return id;
}

const slugByBusiness = new Map<number, { slug: string; at: number }>();

async function businessSlugFor(admin: Admin, businessId: number): Promise<string> {
  const hit = slugByBusiness.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.slug;
  const { data } = await admin.from("businesses").select("slug").eq("id", businessId).maybeSingle();
  const slug = String((data as { slug?: unknown } | null)?.slug ?? "").trim().toLowerCase();
  slugByBusiness.set(businessId, { slug, at: Date.now() });
  return slug;
}

function endOfIsraelDay(now: Date): Date {
  const next = addCalendarDaysYmd(planDayOf(now), 1);
  return (next && israelWallInstant(next, "00:00")) || new Date(now.getTime() + 24 * 60 * 60_000);
}

/** Pause active for this business + trigger. */
/** paused: hold. resumed: Lior resumed it today, the breaker stays off until tomorrow. */
async function triggerPause(
  admin: Admin,
  businessId: number,
  triggerKey: string,
  now: Date
): Promise<"paused" | "resumed" | "none"> {
  const { data, error } = await admin
    .from("send_trigger_pauses")
    .select("paused_until, resumed_at")
    .eq("business_id", businessId)
    .eq("trigger_key", triggerKey)
    .maybeSingle();
  if (error) {
    if (!/does not exist|PGRST205|schema cache/i.test(error.message)) {
      console.error("[send-plan] pause read failed:", error.message, { businessId });
    }
    return "none";
  }
  const row = data as { paused_until?: string; resumed_at?: string | null } | null;
  if (!row) return "none";
  if (row.resumed_at) return planDayOf(new Date(row.resumed_at)) === planDayOf(now) ? "resumed" : "none";
  return Date.parse(String(row.paused_until ?? "")) > now.getTime() ? "paused" : "none";
}

async function hourlyBaseline(admin: Admin, businessId: number, triggerId: string, now: Date): Promise<number> {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(now);
  const key = `${businessId}|${triggerId}|${planDayOf(now)}|${hour}`;
  const hit = baselineCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.avg;
  const history = await loadSendHistory(admin, businessId, now, triggerId);
  let times = history.rows.map((row) => row.created_at);
  if (!history.covered) {
    // Per-trigger history is short: the business's normal volume of this hour is the ceiling.
    const slug = await businessSlugFor(admin, businessId);
    times = (slug ? await loadLoggedTemplateSends(admin, slug, now) : null) ?? times;
  }
  const avg = hourlyAverage(times, now);
  baselineCache.set(key, { avg, at: Date.now() });
  return avg;
}

/**
 * Breaker: more than 3x the normal volume of this hour (min 10) pauses the trigger.
 * Returns true when this send must be held.
 */
async function breakerHolds(input: {
  admin: Admin;
  businessId: number;
  triggerId: string;
  triggerType: string | null;
  now: Date;
}): Promise<boolean> {
  const pause = await triggerPause(input.admin, input.businessId, input.triggerId, input.now);
  if (pause === "paused") return true;
  if (pause === "resumed") return false;
  const sentLastHour = await countSendsSince(
    input.admin,
    input.businessId,
    input.triggerId,
    new Date(input.now.getTime() - 60 * 60_000)
  );
  if (sentLastHour == null) return false;
  const avg = await hourlyBaseline(input.admin, input.businessId, input.triggerId, input.now);
  if (!tripsBreaker(sentLastHour, avg)) return false;
  const { data, error } = await input.admin
    .from("send_trigger_pauses")
    .upsert(
      {
        business_id: input.businessId,
        trigger_key: input.triggerId,
        paused_at: input.now.toISOString(),
        paused_until: endOfIsraelDay(input.now).toISOString(),
        reason: `${sentLastHour} sends in the last hour, limit ${breakerLimit(avg)}`,
        sent_last_hour: sentLastHour,
        hourly_baseline: Number(avg.toFixed(2)),
        resumed_at: null,
        resumed_by: null,
      },
      { onConflict: "business_id,trigger_key" }
    )
    .select("business_id");
  if (error) {
    console.error("[send-plan] breaker pause write failed:", error.message, { businessId: input.businessId });
    return true;
  }
  console.error("[send-plan] circuit breaker tripped", {
    businessId: input.businessId,
    triggerId: input.triggerId,
    triggerType: input.triggerType,
    sentLastHour,
    hourlyBaseline: avg,
  });
  if (data?.length) {
    const { data: biz } = await input.admin.from("businesses").select("name, slug").eq("id", input.businessId).maybeSingle();
    const name =
      String((biz as { name?: unknown } | null)?.name ?? "").trim() ||
      String((biz as { slug?: unknown } | null)?.slug ?? "").trim() ||
      `עסק ${input.businessId}`;
    await sendHeldAlert({
      admin: input.admin,
      headline: `מפסק נפח: ${input.triggerType ?? "טריגר"} של ${name} נעצר עד סוף היום (${sentLastHour} בשעה האחרונה)`,
      rows: [{ business: name, reason: HOLD_REASONS.circuitBreaker, count: 1 }],
    });
  }
  return true;
}

/** null: send. Otherwise the result sendBusinessTemplate returns without calling Meta. */
export async function eventSendGate(input: PlanSendInput): Promise<{ ok: false; error: string } | null> {
  try {
    return await gate(input, new Date());
  } catch (e) {
    console.error("[send-plan] event gate threw, sending:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function gate(input: PlanSendInput, now: Date): Promise<{ ok: false; error: string } | null> {
  const admin = createSupabaseAdminClient();
  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  const businessId = await businessIdFor(admin, phoneNumberId);
  if (!businessId) return null;
  const templateName = input.templateName.trim();
  const phone = normalizePhone(input.to) ?? String(input.to ?? "").replace(/\D/g, "");
  const triggerId = String(input.alertTriggerId ?? "").trim() || null;
  const cached = reads();
  const triggerType =
    canonicalizeTriggerType(
      (await loadTriggerType(admin, cached, triggerId)) ?? triggerTypeFromScheduledDedupKey(String(input.eventDedupKey ?? "")) ?? ""
    ) || null;
  const params = (input.components ?? []).flatMap((c) => (c.type === "body" ? c.parameters.map((p) => p.text) : []));
  const eventKey = planEventKey({ templateClaimEventKey: templateClaimEventKey(input.eventDedupKey), params });
  const planDay = planDayOf(now);
  const dedupKey = planRowDedupKey({
    planDay,
    slot: "event",
    businessId,
    triggerId,
    phone,
    templateName,
    eventKey,
  });

  const { data: existing, error: existingErr } = await admin
    .from("scheduled_template_sends")
    .select("status")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (existingErr && !/plan_|event_|column/i.test(existingErr.message)) {
    console.error("[send-plan] held-row read failed:", existingErr.message, { businessId });
  }
  const existingStatus = String((existing as { status?: unknown } | null)?.status ?? "");
  if (existingStatus === "held") return { ok: false, error: SENDS_HOLD_GATE_ERROR };
  if (existingStatus === "canceled") return { ok: false, error: `${SEND_CHECK_SKIPPED_ERROR}:${ADMIN_CANCELED_REASON}` };
  if (existingStatus === "skipped") return { ok: false, error: `${SEND_CHECK_SKIPPED_ERROR}:skipped` };
  if (["planned", "sending", "sent", "unknown", "blocked"].includes(existingStatus)) {
    return { ok: false, error: DUPLICATE_GUARD_ERROR };
  }

  const recipientKind = input.recipientKind === "staff" ? "staff" : "customer";
  const type = String(triggerType ?? "");
  let skip: string | null = null;
  if (recipientKind !== "staff" && type && (triggerSkipsStaff(type) || LEAVE_REQUEST_TRIGGERS.includes(type))) {
    const contact = await loadContactCheck(admin, businessId, phone, now);
    if (contact?.isStaff && triggerSkipsStaff(type)) skip = SKIP_REASONS.staff;
    else if (contact?.leaveRequest && LEAVE_REQUEST_TRIGGERS.includes(type)) skip = SKIP_REASONS.leaveRequest;
  }

  const meta = await loadTemplateMeta(admin, cached, businessId, templateName);
  const renderedBody = renderWhatsAppTemplatePreview({
    templateName,
    metaComponents: meta?.components,
    sendComponents: input.components,
  });
  const eventMeta = eventMetaFromDedupKey(input.eventDedupKey);
  let hold: { reason: string; detail?: string } | null = null;
  if (!skip) {
    const words = relativeWordMismatch({ body: renderedBody, eventYmd: eventMeta.ymd, sendAt: now });
    if (words) hold = { reason: HOLD_REASONS.relativeWords, detail: words };
  }
  if (!skip && !hold && (await loadWabaBlocked(admin, cached, businessId, now)).blocked) {
    hold = { reason: HOLD_REASONS.wabaBlocked };
  }
  if (!skip && !hold && triggerId && recipientKind !== "staff") {
    if (await breakerHolds({ admin, businessId, triggerId, triggerType, now })) {
      hold = { reason: HOLD_REASONS.circuitBreaker };
    }
  }
  if (!skip && !hold) return null;

  const reason = skip ?? hold!.reason;
  const detail = hold?.detail;
  const { error } = await admin.from("scheduled_template_sends").upsert(
    {
      business_id: businessId,
      trigger_id: triggerId,
      contact_phone: phone,
      template_name: templateName,
      due_at: now.toISOString(),
      status: skip ? "skipped" : "held",
      dedup_key: dedupKey,
      last_error: [reason, detail].filter(Boolean).join(": ").slice(0, 500),
      plan_day: planDay,
      plan_slot: "event",
      phone_number_id: phoneNumberId,
      language_code: input.languageCode?.trim() || meta?.language || "he",
      components: input.components ?? null,
      recipient_kind: recipientKind,
      rendered_body: renderedBody,
      event_key: eventKey,
      event_at: eventStartInstant(eventMeta)?.toISOString() ?? null,
      event_meta: { ...eventMeta, eventDedupKey: input.eventDedupKey ?? null, triggerType },
      hold_reason: reason,
      updated_at: now.toISOString(),
    },
    { onConflict: "dedup_key", ignoreDuplicates: true }
  );
  if (error) console.error("[send-plan] event hold write failed:", error.message, { businessId, reason });
  console.warn("[send-plan] event send not sent", { businessId, templateName, triggerType, reason, held: !skip });
  return skip
    ? { ok: false, error: `${SEND_CHECK_SKIPPED_ERROR}:${reason}` }
    : { ok: false, error: SENDS_HOLD_GATE_ERROR };
}
