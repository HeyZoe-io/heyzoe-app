import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  CALL_SCHEDULE_CTA_LABEL,
  callScheduleDayButtonLabel,
  dayOfWeekFromCallScheduleDayButtonLabel,
  formatCallScheduleSlotForOwner,
  isValidCallScheduleDayOfWeek,
  isValidCallScheduleTimeBlock,
  normalizeCallScheduleSlots,
  timeBlocksForDay,
  uniqueDaysWithSlots,
  type BusinessCallSlotRow,
} from "@/lib/call-schedule-slots";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { withWarmupExtraAwaitingOff } from "@/lib/wa-warmup-awaiting-idx";

export { CALL_SCHEDULE_CTA_LABEL };

export async function fetchBusinessCallSlots(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number | string;
}): Promise<BusinessCallSlotRow[]> {
  const businessId = Number(input.businessId);
  if (!Number.isFinite(businessId) || businessId <= 0) return [];
  const { data, error } = await input.admin
    .from("business_call_slots")
    .select("day_of_week, time_block")
    .eq("business_id", businessId);
  if (error) {
    console.warn("[wa-call-schedule] fetch slots:", error.message);
    return [];
  }
  return normalizeCallScheduleSlots((data ?? []) as BusinessCallSlotRow[]);
}

export function buildCallScheduleDayQuestion(): string {
  return "באיזה יום נוח לכם לשיחה קצרה? בחרו מהכפתורים למטה.";
}

export function buildCallScheduleTimeQuestion(dayOfWeek: number): string {
  const dayLabel = callScheduleDayButtonLabel(dayOfWeek);
  return dayLabel
    ? `מעולה — ${dayLabel}. באיזה טווח שעות נוח לכם?`
    : "באיזה טווח שעות נוח לכם? בחרו מהכפתורים למטה.";
}

export function buildCallScheduleCompletedLeadMessage(slotLine: string): string {
  if (slotLine) {
    return `מעולה! רשמנו שיחה ל${slotLine}.\nנציג אנושי יחזור אליכם בהקדם 😊`;
  }
  return "מעולה! השארתם פנייה ונציג אנושי יחזור אליכם בהקדם 😊";
}

export function buildCallScheduleNoSlotsLeadMessage(): string {
  return "אין כרגע מועדים פנויים ביומן. השארתם פנייה — נציג אנושי יחזור אליכם בהקדם 😊";
}

export async function persistCallScheduleDay(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number | string;
  phone: string;
  dayOfWeek: number;
}): Promise<void> {
  if (!isValidCallScheduleDayOfWeek(input.dayOfWeek)) return;
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  const { error } = await input.supabase
    .from("contacts")
    .update(
      withWarmupExtraAwaitingOff({
        call_schedule_day: input.dayOfWeek,
        call_schedule_time_block: null,
        session_phase: "call_schedule_time",
        flow_step: 0,
      })
    )
    .eq("business_id", input.businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [input.phone]);
  if (error) console.warn("[wa-call-schedule] persist day failed:", error.message);
}

export async function persistCallScheduleTimeComplete(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number | string;
  phone: string;
  dayOfWeek: number;
  timeBlock: string;
}): Promise<void> {
  if (!isValidCallScheduleDayOfWeek(input.dayOfWeek) || !isValidCallScheduleTimeBlock(input.timeBlock)) {
    return;
  }
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  const { error } = await input.supabase
    .from("contacts")
    .update(
      withWarmupExtraAwaitingOff({
        call_schedule_day: input.dayOfWeek,
        call_schedule_time_block: input.timeBlock,
        session_phase: "cta",
        flow_step: 0,
      })
    )
    .eq("business_id", input.businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [input.phone]);
  if (error) console.warn("[wa-call-schedule] persist time failed:", error.message);
}

export function resolveCallScheduleDayChoice(
  text: string,
  metaInteractiveReplyId: string | undefined,
  dayOptions: number[]
): number | null {
  const labels = dayOptions.map(callScheduleDayButtonLabel).filter(Boolean);
  const incoming = String(metaInteractiveReplyId || text || "").trim();
  const fromLabel = dayOfWeekFromCallScheduleDayButtonLabel(incoming);
  if (fromLabel != null && dayOptions.includes(fromLabel)) return fromLabel;
  // numeric 1-based
  if (/^[1-9]$/.test(incoming)) {
    const idx = Number(incoming) - 1;
    if (idx >= 0 && idx < dayOptions.length) return dayOptions[idx]!;
  }
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] && incoming === labels[i]) return dayOptions[i]!;
  }
  return null;
}

export function resolveCallScheduleTimeChoice(
  text: string,
  metaInteractiveReplyId: string | undefined,
  blocks: string[]
): string | null {
  const incoming = String(metaInteractiveReplyId || text || "").trim();
  if (blocks.includes(incoming)) return incoming;
  if (/^[1-9]$/.test(incoming)) {
    const idx = Number(incoming) - 1;
    if (idx >= 0 && idx < blocks.length) return blocks[idx]!;
  }
  return null;
}

export function dayButtonLabelsForSlots(slots: BusinessCallSlotRow[]): string[] {
  return uniqueDaysWithSlots(slots).map(callScheduleDayButtonLabel).filter(Boolean);
}

export function timeButtonLabelsForDay(slots: BusinessCallSlotRow[], dayOfWeek: number): string[] {
  return timeBlocksForDay(slots, dayOfWeek);
}

export function ownerSlotLine(dayOfWeek: number, timeBlock: string): string {
  return formatCallScheduleSlotForOwner({ dayOfWeek, timeBlock });
}
