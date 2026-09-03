import { firstNameFromFullName, formatLeadTemplateMessageContent } from "@/lib/lead-template";
import {
  computeCallDayDueAt,
  parseMarketingCallDay,
  parseMarketingCallSlot,
  resolveCallDayDue,
} from "@/lib/marketing-call-time";
import { toPipelineDateOnly, toPipelineTime } from "@/lib/marketing-next-call";
import {
  resolveMarketingTemplateBodyParams,
  type MarketingTemplateParamSlot,
} from "@/lib/marketing-template-presets";
import type { MarketingTriggerType } from "@/lib/marketing-template-trigger-types";
import { marketingDelayDirectionForTrigger } from "@/lib/marketing-template-trigger-types";
import {
  logMarketingWhatsAppMessage,
  MARKETING_WA_PHONE_NUMBER_ID,
} from "@/lib/marketing-whatsapp";
import { sendBusinessTemplate, type OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import { extractBodyVarCount, bodyTextFromTemplateComponents } from "@/lib/template-presets";
import { normalizePhone } from "@/lib/phone-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildMarketingBroadcastDedupKey,
  buildMarketingCallDayDedupKey,
  buildMarketingFlowCompletedDedupKey,
  buildMarketingNodeAnsweredDedupKey,
  callDateYmdFromCallDayDedupKey,
  enqueueScheduledMarketingTemplateSend,
  parseScheduledBodyParams,
  type ScheduledMarketingTemplateSendRow,
} from "@/lib/scheduled-marketing-template-sends";
import {
  decideScheduledDrainDispatch,
  decideScheduledSendAfterMeta,
  decideScheduledSendGate,
} from "@/lib/scheduled-template-sends";

export const MARKETING_TEMPLATE_MODEL = "marketing_template";

export type MarketingTemplateTriggerRow = {
  id: string;
  trigger_type: MarketingTriggerType;
  flow_node_id: string | null;
  delay_days: number;
  delay_direction: string;
  template_name: string;
  enabled: boolean;
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

function israelDayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function phoneNorm(raw: string): string {
  return (
    normalizePhone(raw) ??
    String(raw ?? "")
      .replace(/\D/g, "")
      .trim()
  );
}

async function loadEnabledTriggers(
  admin: AdminClient,
  type?: MarketingTriggerType
): Promise<MarketingTemplateTriggerRow[]> {
  let q = admin
    .from("marketing_template_triggers")
    .select("id, trigger_type, flow_node_id, delay_days, delay_direction, template_name, enabled")
    .eq("enabled", true);
  if (type) q = q.eq("trigger_type", type);
  const { data, error } = await q;
  if (error) {
    if (/does not exist|schema cache|marketing_template_triggers/i.test(error.message)) {
      return [];
    }
    console.error("[marketing-template-dispatch] load triggers failed:", error.message);
    return [];
  }
  return ((data ?? []) as MarketingTemplateTriggerRow[]).filter((r) =>
    Boolean(String(r.template_name ?? "").trim())
  );
}

async function lookupLeadFirstName(admin: AdminClient, phone: string): Promise<string> {
  const { data, error } = await admin
    .from("marketing_flow_sessions")
    .select("full_name")
    .eq("phone", phone)
    .maybeSingle();
  if (error) return "שלום";
  return firstNameFromFullName(String((data as { full_name?: unknown } | null)?.full_name ?? ""));
}

async function lookupApprovedTemplate(
  admin: AdminClient,
  templateName: string
): Promise<{ name: string; language: string; status: string; disabled: boolean; components: unknown } | null> {
  const { data, error } = await admin
    .from("marketing_whatsapp_templates")
    .select("name, language, status, disabled, components")
    .eq("name", templateName)
    .eq("disabled", false)
    .order("language", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const status = String((data as { status?: unknown }).status ?? "").toUpperCase();
  if (status !== "APPROVED") return null;
  return data as {
    name: string;
    language: string;
    status: string;
    disabled: boolean;
    components: unknown;
  };
}

function bodyComponentsFromParams(params: string[]): OwnerTemplateComponent[] | undefined {
  if (params.length === 0) return undefined;
  return [
    {
      type: "body",
      parameters: params.map((text) => ({ type: "text" as const, text: text || "—" })),
    },
  ];
}

export async function sendMarketingLeadTemplate(input: {
  admin: AdminClient;
  phone: string;
  templateName: string;
  bodyParams: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const phone = phoneNorm(input.phone);
  const templateName = String(input.templateName ?? "").trim();
  if (!phone || !templateName) return { ok: false, error: "missing_fields" };

  const approved = await lookupApprovedTemplate(input.admin, templateName);
  const gate = decideScheduledSendGate({
    hasChannel: true,
    hasWaba: true,
    hasApprovedTemplate: Boolean(approved),
  });
  if (gate.action === "cancel") {
    return { ok: false, error: gate.last_error };
  }

  const languageCode = String(approved?.language ?? "he").trim() || "he";
  const components = bodyComponentsFromParams(input.bodyParams);
  const sendResult = await sendBusinessTemplate({
    to: phone,
    phoneNumberId: MARKETING_WA_PHONE_NUMBER_ID,
    templateName,
    languageCode,
    ...(components ? { components } : {}),
  });

  if (!sendResult.ok) {
    console.error("[marketing-template-dispatch] Meta send failed:", sendResult.error, {
      phone,
      templateName,
    });
    return { ok: false, error: sendResult.error };
  }

  try {
    await logMarketingWhatsAppMessage({
      leadPhone: phone,
      role: "assistant",
      content: formatLeadTemplateMessageContent(templateName, {
        firstName: input.bodyParams[0],
        components: approved?.components,
        bodyParams: input.bodyParams,
      }),
      model_used: MARKETING_TEMPLATE_MODEL,
    });
  } catch (e) {
    console.error("[marketing-template-dispatch] conversation log failed:", e);
  }

  return { ok: true };
}

function paramsForTrigger(input: {
  triggerType: MarketingTriggerType | "broadcast";
  components: unknown;
  firstName: string;
  callTime?: string | null;
}): string[] {
  const body = bodyTextFromTemplateComponents(input.components);
  const varCount = extractBodyVarCount(body);
  return resolveMarketingTemplateBodyParams({
    triggerType: input.triggerType,
    varCount,
    firstName: input.firstName,
    callTime: input.callTime,
  });
}

async function dispatchOrEnqueue(input: {
  admin: AdminClient;
  trigger: MarketingTemplateTriggerRow;
  phone: string;
  dueAt: Date;
  dedupKey: string;
  firstName: string;
  callTime?: string | null;
  now?: Date;
}): Promise<void> {
  const templateName = String(input.trigger.template_name ?? "").trim();
  const approved = await lookupApprovedTemplate(input.admin, templateName);
  const bodyParams = paramsForTrigger({
    triggerType: input.trigger.trigger_type,
    components: approved?.components,
    firstName: input.firstName,
    callTime: input.callTime,
  });
  const now = input.now ?? new Date();
  const immediate = input.dueAt.getTime() <= now.getTime() + 15_000;

  const queued = await enqueueScheduledMarketingTemplateSend({
    admin: input.admin,
    triggerId: input.trigger.id,
    contactPhone: input.phone,
    templateName,
    dueAt: immediate ? now : input.dueAt,
    dedupKey: input.dedupKey,
    bodyParams,
  });
  if (!queued.ok) {
    console.error("[marketing-template-dispatch] enqueue failed:", queued.error, {
      triggerId: input.trigger.id,
    });
    return;
  }
  if (!queued.inserted) return;
  if (!immediate) return;

  const sent = await sendMarketingLeadTemplate({
    admin: input.admin,
    phone: input.phone,
    templateName,
    bodyParams,
  });
  const nowIso = new Date().toISOString();
  const { error: markErr } = await input.admin
    .from("scheduled_marketing_template_sends")
    .update({
      status: sent.ok ? "sent" : "failed",
      last_error: sent.ok ? null : String(sent.error ?? "send_failed").slice(0, 500),
      updated_at: nowIso,
    })
    .eq("dedup_key", input.dedupKey)
    .eq("status", "pending");
  if (markErr) {
    console.error("[marketing-template-dispatch] mark after immediate send failed:", markErr.message);
  }
}

async function saveParsedCallTime(
  admin: AdminClient,
  phone: string,
  dateYmd: string,
  timeHm: string | null
): Promise<void> {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    next_call_at: dateYmd,
    updated_at: nowIso,
  };
  if (timeHm) patch.next_call_time = timeHm;
  const { error } = await admin.from("marketing_flow_sessions").update(patch).eq("phone", phone);
  if (error && !/next_call/i.test(error.message)) {
    console.warn("[marketing-template-dispatch] save next_call failed:", error.message);
  }
}

async function inferCallDateFromSessionOrAnswers(
  admin: AdminClient,
  phone: string,
  now: Date
): Promise<{ dateYmd: string; timeHm: string | null } | null> {
  const { data: answers, error } = await admin
    .from("marketing_lead_answers")
    .select("answer_text")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) {
      console.warn("[marketing-template-dispatch] answers lookup failed:", error.message);
    }
  } else {
    for (const row of answers ?? []) {
      const text = String((row as { answer_text?: unknown }).answer_text ?? "");
      const slot = parseMarketingCallSlot(text, now);
      if (slot?.hasDate && slot.dateYmd) return { dateYmd: slot.dateYmd, timeHm: slot.timeHm };
      const day = parseMarketingCallDay(text, now);
      if (day) return { dateYmd: day, timeHm: null };
    }
  }

  const { data: sess } = await admin
    .from("marketing_flow_sessions")
    .select("next_call_at, next_call_time")
    .eq("phone", phone)
    .maybeSingle();
  const existingDate = toPipelineDateOnly(
    (sess as { next_call_at?: unknown } | null)?.next_call_at
  );
  const existingTime = toPipelineTime(
    (sess as { next_call_time?: unknown } | null)?.next_call_time
  );
  if (existingDate) return { dateYmd: existingDate, timeHm: existingTime };
  return null;
}

async function enqueueCallDayTriggers(input: {
  admin: AdminClient;
  phone: string;
  dateYmd: string;
  timeHm: string | null;
  firstName: string;
  now?: Date;
  sourceNodeId?: string | null;
}): Promise<void> {
  let rules = await loadEnabledTriggers(input.admin, "call_day");
  const sourceNodeId = String(input.sourceNodeId ?? "").trim();
  if (sourceNodeId) {
    rules = rules.filter((r) => {
      const bound = String(r.flow_node_id ?? "").trim();
      return !bound || bound === sourceNodeId;
    });
  }
  const now = input.now ?? new Date();
  for (const rule of rules) {
    const dueAt = computeCallDayDueAt({
      dateYmd: input.dateYmd,
      timeHm: input.timeHm,
      delayDays: rule.delay_days,
      delayDirection: marketingDelayDirectionForTrigger(rule.trigger_type, rule.delay_direction),
      now,
    });
    if (!dueAt) {
      console.info("[marketing-template-dispatch] skip call_day — not the send day", {
        triggerId: rule.id,
        phone: input.phone,
        dateYmd: input.dateYmd,
        delay_days: rule.delay_days,
      });
      continue;
    }
    await dispatchOrEnqueue({
      admin: input.admin,
      trigger: rule,
      phone: input.phone,
      dueAt,
      dedupKey: buildMarketingCallDayDedupKey(rule.id, input.phone, input.dateYmd),
      firstName: input.firstName,
      callTime: input.timeHm,
      now,
    });
  }
}

export async function onMarketingFlowNodeAnswered(input: {
  phone: string;
  questionNodeId: string;
  answerText: string;
}): Promise<void> {
  const phone = phoneNorm(input.phone);
  const nodeId = String(input.questionNodeId ?? "").trim();
  if (!phone || !nodeId) return;

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const firstName = await lookupLeadFirstName(admin, phone);
  const parsed = parseMarketingCallSlot(input.answerText, now);
  const dayOnly = parsed?.hasDate ? null : parseMarketingCallDay(input.answerText, now);

  let dateYmd: string | null = parsed?.hasDate ? parsed.dateYmd : dayOnly;
  let timeHm: string | null = parsed?.timeHm ?? null;

  if (parsed && !parsed.hasDate) {
    const inferred = await inferCallDateFromSessionOrAnswers(admin, phone, now);
    dateYmd = inferred?.dateYmd ?? null;
    if (!timeHm) timeHm = inferred?.timeHm ?? null;
  } else if (dayOnly && !timeHm) {
    const inferred = await inferCallDateFromSessionOrAnswers(admin, phone, now);
    timeHm = inferred?.timeHm ?? null;
  }

  if (dateYmd && timeHm) {
    await saveParsedCallTime(admin, phone, dateYmd, timeHm);
    await enqueueCallDayTriggers({
      admin,
      phone,
      dateYmd,
      timeHm,
      firstName,
      now,
      sourceNodeId: nodeId,
    });
  } else if (dateYmd) {
    await saveParsedCallTime(admin, phone, dateYmd, null);
  }

  const answeredRules = (await loadEnabledTriggers(admin, "node_answered")).filter(
    (r) => String(r.flow_node_id ?? "") === nodeId
  );
  const eventDay = israelDayYmd(now);
  for (const rule of answeredRules) {
    const days = Math.max(0, Math.trunc(Number(rule.delay_days) || 0));
    const dueAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    await dispatchOrEnqueue({
      admin,
      trigger: rule,
      phone,
      dueAt,
      dedupKey: buildMarketingNodeAnsweredDedupKey(rule.id, phone, eventDay),
      firstName,
      callTime: timeHm,
      now,
    });
  }
}

export async function onMarketingFlowCompleted(input: { phone: string }): Promise<void> {
  const phone = phoneNorm(input.phone);
  if (!phone) return;
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const firstName = await lookupLeadFirstName(admin, phone);
  const eventDay = israelDayYmd(now);
  const rules = await loadEnabledTriggers(admin, "flow_completed");
  for (const rule of rules) {
    const days = Math.max(0, Math.trunc(Number(rule.delay_days) || 0));
    const dueAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    await dispatchOrEnqueue({
      admin,
      trigger: rule,
      phone,
      dueAt,
      dedupKey: buildMarketingFlowCompletedDedupKey(rule.id, phone, eventDay),
      firstName,
      now,
    });
  }
}

export async function onMarketingCallScheduled(input: {
  phone: string;
  dateYmd: string;
  timeHm?: string | null;
}): Promise<void> {
  const phone = phoneNorm(input.phone);
  const dateYmd = toPipelineDateOnly(input.dateYmd);
  if (!phone || !dateYmd) return;
  const admin = createSupabaseAdminClient();
  const firstName = await lookupLeadFirstName(admin, phone);
  await enqueueCallDayTriggers({
    admin,
    phone,
    dateYmd,
    timeHm: input.timeHm ?? null,
    firstName,
  });
}

export async function dispatchDueMarketingScheduledSend(
  admin: AdminClient,
  row: ScheduledMarketingTemplateSendRow,
  opts?: { now?: Date; honorSendWindow?: boolean }
): Promise<"sent" | "failed" | "canceled" | "skipped"> {
  const now = opts?.now ?? new Date();
  if (opts?.honorSendWindow && decideScheduledDrainDispatch(now).action === "hold") {
    return "skipped";
  }
  const phone = phoneNorm(row.contact_phone);
  const templateName = String(row.template_name ?? "").trim();
  const approved = await lookupApprovedTemplate(admin, templateName);
  const gate = decideScheduledSendGate({
    hasChannel: Boolean(phone),
    hasWaba: true,
    hasApprovedTemplate: Boolean(approved),
  });

  const nowIso = new Date().toISOString();
  async function mark(status: "sent" | "failed" | "canceled", last_error: string | null) {
    const { error } = await admin
      .from("scheduled_marketing_template_sends")
      .update({ status, last_error, updated_at: nowIso })
      .eq("id", row.id)
      .eq("status", "pending");
    if (error) {
      console.error("[marketing-template-dispatch] status update failed:", error.message, {
        id: row.id,
      });
    }
  }

  const callDateYmd = callDateYmdFromCallDayDedupKey(row.dedup_key);
  if (callDateYmd) {
    let delayDays = 0;
    let delayDirection = "after";
    if (row.trigger_id) {
      const { data: trig } = await admin
        .from("marketing_template_triggers")
        .select("delay_days, delay_direction")
        .eq("id", row.trigger_id)
        .maybeSingle();
      if (trig) {
        delayDays = Number((trig as { delay_days?: unknown }).delay_days ?? 0);
        delayDirection = String((trig as { delay_direction?: unknown }).delay_direction ?? "after");
      }
    }
    const resolved = resolveCallDayDue({
      dateYmd: callDateYmd,
      delayDays,
      delayDirection,
    });
    if (resolved.kind === "skip_past" || resolved.kind === "invalid") {
      await mark("canceled", "call_day_not_today");
      return "canceled";
    }
    if (resolved.kind === "schedule") {
      const { error } = await admin
        .from("scheduled_marketing_template_sends")
        .update({ due_at: resolved.at.toISOString(), updated_at: nowIso, last_error: "rescheduled_to_call_day" })
        .eq("id", row.id)
        .eq("status", "pending");
      if (error) {
        console.error("[marketing-template-dispatch] reschedule call_day failed:", error.message, {
          id: row.id,
        });
      }
      return "skipped";
    }
  }

  if (gate.action === "cancel") {
    await mark("canceled", gate.last_error);
    return "canceled";
  }

  const bodyParams = parseScheduledBodyParams(row.body_params);
  const sent = await sendMarketingLeadTemplate({
    admin,
    phone,
    templateName,
    bodyParams,
  });
  const after = decideScheduledSendAfterMeta({ ok: sent.ok, error: sent.error });
  if (after.status === "failed") {
    await mark("failed", after.last_error);
    return "failed";
  }
  await mark("sent", null);
  return "sent";
}

export async function enqueueMarketingBroadcast(input: {
  phones: string[];
  templateName: string;
  dueAt: Date;
  batchId: string;
}): Promise<{ queued: number; errors: number }> {
  const admin = createSupabaseAdminClient();
  const templateName = String(input.templateName ?? "").trim();
  const approved = await lookupApprovedTemplate(admin, templateName);
  let queued = 0;
  let errors = 0;
  for (const raw of input.phones) {
    const phone = phoneNorm(raw);
    if (!phone) continue;
    const firstName = await lookupLeadFirstName(admin, phone);
    const bodyParams = paramsForTrigger({
      triggerType: "broadcast",
      components: approved?.components,
      firstName,
    });
    const result = await enqueueScheduledMarketingTemplateSend({
      admin,
      triggerId: null,
      contactPhone: phone,
      templateName,
      dueAt: input.dueAt,
      dedupKey: buildMarketingBroadcastDedupKey(input.batchId, phone),
      bodyParams,
    });
    if (result.ok && result.inserted) queued += 1;
    else if (!result.ok) errors += 1;
  }
  return { queued, errors };
}

export type { MarketingTemplateParamSlot };
