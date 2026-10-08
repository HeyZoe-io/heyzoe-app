/**
 * Template components for one queued scheduled_template_sends row, from its dedup key.
 * Pure. Shared by the Stage C drain (send) and PLAN (check a queued row when it is queued).
 */
import type { OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import {
  classDateYmdFromStaffDedupKey,
  classDateYmdFromTrainerHeadsUpDedupKey,
  classDateYmdFromTrialReminderDedupKey,
  classNameFromScheduledDedupKey,
  classTimeFromScheduledDedupKey,
  expiryYmdFromScheduledDedupKey,
  membershipTypeNameFromScheduledDedupKey,
  startDateYmdFromScheduledDedupKey,
  templateSendPayload,
  trainerHeadsUpTemplateParamValues,
  trialReminderTemplateParamValues,
} from "@/lib/template-send-params";

export type ScheduledSendPayload =
  | { ok: true; sendComponents: OwnerTemplateComponent[] | undefined; bodyParams: string[] }
  | { ok: false; reason: string; varCount: number };

export function buildScheduledSendPayload(input: {
  triggerType: string;
  dedupKey: string;
  storedComponents: unknown;
  firstName: string | null | undefined;
  staffClientFirst: string | null;
  clientGeneralNotes?: string;
  businessName: string;
}): ScheduledSendPayload {
  const dedupKey = input.dedupKey;
  let { sendComponents, bodyParams } = templateSendPayload({
    triggerType: input.triggerType,
    storedComponents: input.storedComponents,
    firstName: input.firstName,
    clientFullName: input.staffClientFirst,
    clientGeneralNotes: input.clientGeneralNotes,
    businessName: input.businessName,
    expiryDateYmd: classDateYmdFromStaffDedupKey(dedupKey) ?? expiryYmdFromScheduledDedupKey(dedupKey),
    startDateYmd: startDateYmdFromScheduledDedupKey(dedupKey),
    membershipTypeName: membershipTypeNameFromScheduledDedupKey(dedupKey),
    className: classNameFromScheduledDedupKey(dedupKey),
    classTime: classTimeFromScheduledDedupKey(dedupKey),
    classDateYmd: classDateYmdFromTrainerHeadsUpDedupKey(dedupKey),
  });
  if (input.triggerType === "trainer_trial_heads_up") {
    const filled = trainerHeadsUpTemplateParamValues({
      storedComponents: input.storedComponents,
      className: classNameFromScheduledDedupKey(dedupKey),
      classTime: classTimeFromScheduledDedupKey(dedupKey),
      clientFullName: input.staffClientFirst,
      clientGeneralNotes: input.clientGeneralNotes,
      classDateYmd: classDateYmdFromTrainerHeadsUpDedupKey(dedupKey),
    });
    if (!filled.ok) return filled;
    bodyParams = filled.values;
    sendComponents = [{ type: "body", parameters: filled.values.map((text) => ({ type: "text" as const, text })) }];
  }
  if (input.triggerType === "trial_reminder") {
    const filled = trialReminderTemplateParamValues({
      storedComponents: input.storedComponents,
      firstName: input.firstName ?? null,
      className: classNameFromScheduledDedupKey(dedupKey),
      classTime: classTimeFromScheduledDedupKey(dedupKey),
      classDateYmd: classDateYmdFromTrialReminderDedupKey(dedupKey),
    });
    if (!filled.ok) return filled;
    bodyParams = filled.values;
    sendComponents =
      filled.values.length > 0
        ? [{ type: "body", parameters: filled.values.map((text) => ({ type: "text" as const, text })) }]
        : undefined;
  }
  return { ok: true, sendComponents, bodyParams };
}
