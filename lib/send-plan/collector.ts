/**
 * PLAN for one business, one slot. The daily run executes exactly as today (same Arbox reads,
 * same sync-log claims, same enqueues). sendBusinessTemplate hands every send to record(),
 * which checks it and writes it to scheduled_template_sends as planned / held / blocked /
 * skipped with the rendered body. Rows the run queues (e.g. the 15:00 expiry queue) are
 * checked in finalize(), when they are queued. Volume is checked once per business at the end.
 *
 * IO per item: one contact read, one claim read, one queue read, one insert.
 * Per business: one template read per template, one baseline read, one WABA read.
 * No Meta and no Arbox calls.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { DUPLICATE_GUARD_ERROR } from "@/lib/notifications/template-duplicate-guard";
import { templateClaimEventKey } from "@/lib/notifications/template-send-claim";
import { SUPPRESSED_OPT_OUT_ERROR } from "@/lib/wa-marketing-opt-out";
import { renderWhatsAppTemplatePreview } from "@/lib/wa-zoe-admin-template-log";
import { canonicalizeTriggerType, isStaffRecipientTriggerType } from "@/lib/template-trigger-types";
import {
  clientFirstNameFromStaffDedupKey,
  templateBodyUsesSlot,
  triggerTypeFromScheduledDedupKey,
} from "@/lib/template-send-params";
import { firstNameFromFullName } from "@/lib/lead-template";
import { resolveTemplateFirstName, resolveTrialReminderFirstName } from "@/lib/template-first-name";
import { buildScheduledSendPayload } from "@/lib/scheduled-send-payload";
import {
  checkPlanItem,
  dailyAverages,
  eventMetaFromDedupKey,
  eventStartInstant,
  groupVolumeHolds,
  HOLD_REASONS,
  planEventKey,
  SEND_CHECK_SKIPPED_ERROR,
  planRowDedupKey,
  SKIP_REASONS,
  type PlanItemStatus,
  type PlanSlot,
} from "@/lib/send-plan/checks";
import {
  emptyPlanReadCache,
  findCertainDuplicate,
  loadContactCheck,
  loadSendHistory,
  loadTemplateMeta,
  loadTriggerType,
  loadWabaBlocked,
  optOutSuppresses,
  type PlanReadCache,
} from "@/lib/send-plan/data";
import type { PlanEnqueueInput, PlanLogInput, PlanSendInput, SendPlanHandle } from "@/lib/send-plan/types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const PLAN_WRITE_FAILED_ERROR = "plan_write_failed";

export type PlanItem = {
  id: string;
  source: "send" | "queue";
  dedupKey: string;
  triggerId: string | null;
  triggerType: string | null;
  phone: string;
  phoneTail: string;
  templateName: string;
  status: PlanItemStatus;
  reason: string | null;
  detail?: string;
  renderedBody: string;
  eventKey: string;
  dueAt: string;
};

export type PlanSummary = {
  business_id: number;
  slot: PlanSlot;
  plan_day: string;
  planned: number;
  held: number;
  blocked: number;
  skipped: number;
  queued_checked: number;
  held_by_reason: Record<string, number>;
  volume_groups: Array<{ group: string; count: number; limit: number }>;
  write_errors: number;
};

type QueuedNote = PlanEnqueueInput & { firstSeenAt: number };

export class SendPlanCollector implements SendPlanHandle {
  readonly items: PlanItem[] = [];
  private readonly queued: QueuedNote[] = [];
  private readonly logTargets = new Map<string, string>();
  private readonly cache: PlanReadCache = emptyPlanReadCache();
  private readonly seenEvents = new Set<string>();
  private writeErrors = 0;

  constructor(
    private readonly admin: Admin,
    readonly businessId: number,
    readonly slot: PlanSlot,
    readonly planDay: string,
    readonly dispatchAt: Date,
    readonly dryRun: boolean,
    private readonly planNow: Date,
    /** legacy: the run sends as today; only rows it queues are checked. */
    readonly mode: "plan" | "legacy" = "plan"
  ) {}

  get intercepts(): boolean {
    return this.mode === "plan";
  }

  shiftDue(dueAt: Date): Date {
    if (this.mode !== "plan") return dueAt;
    if (dueAt.getTime() >= this.dispatchAt.getTime()) return dueAt;
    const shift = Math.max(0, this.dispatchAt.getTime() - this.planNow.getTime());
    return new Date(Math.max(dueAt.getTime() + shift, this.dispatchAt.getTime()));
  }

  noteEnqueue(input: PlanEnqueueInput): void {
    this.queued.push({ ...input, firstSeenAt: Date.now() });
  }

  captureLog(entry: PlanLogInput): boolean {
    if (this.mode !== "plan" || entry.role !== "assistant") return false;
    const session = String(entry.session_id ?? "");
    const dedupKey = session ? this.logTargets.get(session) : undefined;
    if (!dedupKey) return false;
    this.logTargets.delete(session);
    if (this.dryRun) return true;
    void this.admin
      .from("scheduled_template_sends")
      .update({ log_message: entry, updated_at: new Date().toISOString() })
      .eq("dedup_key", dedupKey)
      .then(({ error }) => {
        if (error) console.error("[send-plan] log capture failed:", error.message, { dedupKey });
      });
    return true;
  }

  async record(input: PlanSendInput): Promise<{ ok: boolean; error?: string }> {
    const phone = normalizePhone(input.to) ?? String(input.to ?? "").replace(/\D/g, "");
    const templateName = input.templateName.trim();
    const triggerId = String(input.alertTriggerId ?? "").trim() || null;
    const triggerType = canonicalizeTriggerType(
      (await loadTriggerType(this.admin, this.cache, triggerId)) ??
        triggerTypeFromScheduledDedupKey(String(input.eventDedupKey ?? "")) ??
        ""
    ) || null;
    const recipientKind = input.recipientKind === "staff" ? "staff" : "customer";
    const params = (input.components ?? []).flatMap((c) => (c.type === "body" ? c.parameters.map((p) => p.text) : []));
    const claimEventKey = templateClaimEventKey(input.eventDedupKey);
    const eventKey = planEventKey({ templateClaimEventKey: claimEventKey, params });
    const dedupKey = planRowDedupKey({
      planDay: this.planDay,
      slot: this.slot,
      businessId: this.businessId,
      triggerId,
      phone,
      templateName,
      eventKey,
    });
    const meta = await loadTemplateMeta(this.admin, this.cache, this.businessId, templateName);
    const renderedBody = renderWhatsAppTemplatePreview({
      templateName,
      metaComponents: meta?.components,
      sendComponents: input.components,
    });
    const eventMeta = eventMetaFromDedupKey(input.eventDedupKey);
    const eventAt = eventStartInstant(eventMeta);
    const inRun = `${phone}|${templateName}|${eventKey}`;
    const duplicate =
      this.seenEvents.has(inRun) ||
      (
        await findCertainDuplicate({
          admin: this.admin,
          businessId: this.businessId,
          phone,
          templateName,
          claimEventKey,
          queueEventKey: eventKey,
          ownDedupKey: dedupKey,
          now: this.planNow,
        })
      ).duplicate;
    this.seenEvents.add(inRun);
    const contact = recipientKind === "staff" ? null : await loadContactCheck(this.admin, this.businessId, phone, this.planNow);
    const waba = await loadWabaBlocked(this.admin, this.cache, this.businessId, this.planNow);
    const result = checkPlanItem({
      triggerType,
      recipientKind,
      components: input.components,
      renderedBody,
      eventYmd: eventMeta.ymd,
      sendAt: this.dispatchAt,
      duplicate,
      contact,
      optOutSuppress: recipientKind !== "staff" && optOutSuppresses(contact, meta?.category ?? null),
      wabaBlocked: waba.blocked,
    });
    const item: PlanItem = {
      id: dedupKey,
      source: "send",
      dedupKey,
      triggerId,
      triggerType,
      phone,
      phoneTail: phone.slice(-4),
      templateName,
      status: result.status,
      reason: result.reason,
      ...(result.detail ? { detail: result.detail } : {}),
      renderedBody,
      eventKey,
      dueAt: this.dispatchAt.toISOString(),
    };
    this.items.push(item);
    if (!this.dryRun) {
      const { data, error } = await this.admin
        .from("scheduled_template_sends")
        .upsert(
          {
            business_id: this.businessId,
            trigger_id: triggerId,
            contact_phone: phone,
            template_name: templateName,
            due_at: this.dispatchAt.toISOString(),
            status: result.status,
            dedup_key: dedupKey,
            last_error: result.reason ? [result.reason, result.detail].filter(Boolean).join(": ").slice(0, 500) : null,
            plan_day: this.planDay,
            plan_slot: this.slot,
            phone_number_id: input.phoneNumberId,
            language_code: input.languageCode?.trim() || meta?.language || "he",
            components: input.components ?? null,
            recipient_kind: recipientKind,
            rendered_body: renderedBody,
            event_key: eventKey,
            event_at: eventAt?.toISOString() ?? null,
            event_meta: { ...eventMeta, eventDedupKey: input.eventDedupKey ?? null, triggerType },
            hold_reason: result.reason,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "dedup_key", ignoreDuplicates: true }
        )
        .select("id");
      if (error) {
        this.writeErrors += 1;
        item.status = "held";
        item.reason = PLAN_WRITE_FAILED_ERROR;
        console.error("[send-plan] plan write failed:", error.message, { businessId: this.businessId, templateName });
        return { ok: false, error: PLAN_WRITE_FAILED_ERROR };
      }
      if (!data?.length) {
        item.status = "blocked";
        item.reason = "duplicate";
        return { ok: false, error: DUPLICATE_GUARD_ERROR };
      }
    }
    if (result.status === "planned" || result.status === "held") {
      const session = buildWaSessionId(input.phoneNumberId, phone);
      if (session) this.logTargets.set(session, dedupKey);
      return { ok: true };
    }
    if (result.status === "blocked") return { ok: false, error: DUPLICATE_GUARD_ERROR };
    if (result.reason === SKIP_REASONS.optedOut) return { ok: false, error: SUPPRESSED_OPT_OUT_ERROR };
    return { ok: false, error: `${SEND_CHECK_SKIPPED_ERROR}:${result.reason}` };
  }

  /** Queue checks, then the volume check. Returns the business summary. */
  async finalize(): Promise<PlanSummary> {
    let queuedChecked = 0;
    const businessName = await this.businessName();
    for (const note of this.queued) {
      const item = await this.checkQueued(note, businessName).catch((e) => {
        console.error("[send-plan] queued check failed:", e instanceof Error ? e.message : e, {
          dedupKey: note.dedupKey,
        });
        return null;
      });
      if (item) {
        this.items.push(item);
        queuedChecked += 1;
      }
    }

    const history = await loadSendHistory(this.admin, this.businessId, this.planNow);
    const averages = dailyAverages(history.rows);
    const volume = history.ok
      ? groupVolumeHolds({
          items: this.items.map((item) => ({
            id: item.id,
            triggerKey: item.triggerId ?? "none",
            status: item.status,
          })),
          triggerDailyAverage: averages.byTrigger,
          businessDailyAverage: averages.business,
        })
      : { ids: new Set<string>(), groups: [] };
    for (const item of this.items) {
      if (!volume.ids.has(item.id) || item.status !== "planned") continue;
      item.status = "held";
      item.reason = HOLD_REASONS.volumeAnomaly;
      if (this.dryRun) continue;
      const { error } = await this.admin
        .from("scheduled_template_sends")
        .update({
          status: "held",
          hold_reason: HOLD_REASONS.volumeAnomaly,
          last_error: HOLD_REASONS.volumeAnomaly,
          plan_day: this.planDay,
          plan_slot: this.slot,
          updated_at: new Date().toISOString(),
        })
        .eq("dedup_key", item.dedupKey)
        .in("status", item.source === "send" ? ["planned"] : ["pending"]);
      if (error) {
        this.writeErrors += 1;
        console.error("[send-plan] volume hold write failed:", error.message, { dedupKey: item.dedupKey });
      }
    }

    const summary: PlanSummary = {
      business_id: this.businessId,
      slot: this.slot,
      plan_day: this.planDay,
      planned: 0,
      held: 0,
      blocked: 0,
      skipped: 0,
      queued_checked: queuedChecked,
      held_by_reason: {},
      volume_groups: volume.groups,
      write_errors: this.writeErrors,
    };
    for (const item of this.items) {
      summary[item.status] += 1;
      if (item.status === "held") {
        const reason = item.reason ?? "unknown";
        summary.held_by_reason[reason] = (summary.held_by_reason[reason] ?? 0) + 1;
      }
    }
    return summary;
  }

  private async businessName(): Promise<string> {
    const { data } = await this.admin.from("businesses").select("name").eq("id", this.businessId).maybeSingle();
    return String((data as { name?: unknown } | null)?.name ?? "");
  }

  /** The same checks as a planned send, on a row the run queued. Writes only when not planned. */
  private async checkQueued(note: QueuedNote, businessName: string): Promise<PlanItem | null> {
    const templateName = note.templateName.trim();
    const phone = normalizePhone(note.contactPhone) ?? note.contactPhone.replace(/\D/g, "");
    const triggerType = canonicalizeTriggerType(
      (await loadTriggerType(this.admin, this.cache, note.triggerId)) ??
        triggerTypeFromScheduledDedupKey(note.dedupKey) ??
        ""
    );
    const staff = note.recipientKind === "staff" || isStaffRecipientTriggerType(triggerType);
    const meta = await loadTemplateMeta(this.admin, this.cache, this.businessId, templateName);
    const contact = staff ? null : await loadContactCheck(this.admin, this.businessId, phone, this.planNow);
    const fullName = staff ? null : await this.contactFullName(phone);
    const staffClientFirst = staff ? clientFirstNameFromStaffDedupKey(note.dedupKey) : null;
    const firstName = staff
      ? firstNameFromFullName(String(staffClientFirst || ""))
      : triggerType === "trial_reminder"
        ? resolveTrialReminderFirstName({ full_name: fullName })
        : resolveTemplateFirstName({ full_name: fullName });
    const usesNotes = templateBodyUsesSlot(triggerType, meta?.components, "client_general_notes");
    const payload = buildScheduledSendPayload({
      triggerType,
      dedupKey: note.dedupKey,
      storedComponents: meta?.components,
      firstName,
      staffClientFirst,
      clientGeneralNotes: usesNotes ? "(הערות מארבוקס)" : undefined,
      businessName,
    });
    const components = payload.ok ? payload.sendComponents : undefined;
    const renderedBody = renderWhatsAppTemplatePreview({
      templateName,
      metaComponents: meta?.components,
      sendComponents: components,
    });
    const claimEventKey = templateClaimEventKey(note.dedupKey);
    const eventKey = planEventKey({
      templateClaimEventKey: claimEventKey,
      params: payload.ok ? payload.bodyParams : [],
    });
    const duplicate = (
      await findCertainDuplicate({
        admin: this.admin,
        businessId: this.businessId,
        phone,
        templateName,
        claimEventKey,
        queueEventKey: eventKey,
        ownDedupKey: note.dedupKey,
        now: this.planNow,
      })
    ).duplicate;
    const waba = await loadWabaBlocked(this.admin, this.cache, this.businessId, this.planNow);
    const result = payload.ok
      ? checkPlanItem({
          triggerType,
          recipientKind: staff ? "staff" : "customer",
          components,
          renderedBody,
          eventYmd: eventMetaFromDedupKey(note.dedupKey).ymd,
          sendAt: note.dueAt,
          duplicate,
          contact,
          optOutSuppress: !staff && optOutSuppresses(contact, meta?.category ?? null),
          wabaBlocked: waba.blocked,
        })
      : duplicate
        ? { status: "blocked" as const, reason: "duplicate" }
        : { status: "held" as const, reason: HOLD_REASONS.emptyVariable, detail: payload.reason };
    const item: PlanItem = {
      id: note.dedupKey,
      source: "queue",
      dedupKey: note.dedupKey,
      triggerId: note.triggerId,
      triggerType: triggerType || null,
      phone,
      phoneTail: phone.slice(-4),
      templateName,
      status: result.status,
      reason: result.reason,
      ...("detail" in result && result.detail ? { detail: result.detail } : {}),
      renderedBody,
      eventKey,
      dueAt: note.dueAt.toISOString(),
    };
    if (this.dryRun) return item;
    const eventMeta = eventMetaFromDedupKey(note.dedupKey);
    const patch: Record<string, unknown> = {
      rendered_body: renderedBody,
      event_key: eventKey,
      event_at: eventStartInstant(eventMeta)?.toISOString() ?? null,
      event_meta: { ...eventMeta, eventDedupKey: note.dedupKey, triggerType },
      updated_at: new Date().toISOString(),
    };
    if (result.status !== "planned") {
      Object.assign(patch, {
        status: result.status,
        hold_reason: result.reason,
        last_error: [result.reason, "detail" in result ? result.detail : null].filter(Boolean).join(": ").slice(0, 500),
        plan_day: this.planDay,
        plan_slot: this.mode === "plan" ? this.slot : "queue",
      });
    }
    const { error } = await this.admin
      .from("scheduled_template_sends")
      .update(patch)
      .eq("dedup_key", note.dedupKey)
      .eq("status", "pending");
    if (error) {
      this.writeErrors += 1;
      console.error("[send-plan] queued check write failed:", error.message, { dedupKey: note.dedupKey });
    }
    return item;
  }

  private async contactFullName(phone: string): Promise<string | null> {
    const variants = contactPhoneLookupVariants(phone);
    const { data } = await this.admin
      .from("contacts")
      .select("full_name, last_contact_at")
      .eq("business_id", this.businessId)
      .in("phone", variants.length ? variants : [phone])
      .order("last_contact_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const name = String((data as { full_name?: string | null } | null)?.full_name ?? "").trim();
    return name || null;
  }
}
