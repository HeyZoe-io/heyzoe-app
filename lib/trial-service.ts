export {
  WA_BUTTON_LABEL_MAX_CHARS as TRIAL_SERVICE_NAME_MAX_CHARS,
  truncateWaButtonLabel as truncateTrialServiceName,
} from "@/lib/wa-button-label";

/** רשימת בחירה בווטסאפ — עד 10 שורות (Meta list). */
export const WA_MAX_PRODUCTS = 10;

export function capWhatsAppProducts<T>(items: T[], existingCount = 0): T[] {
  const cap = Math.max(WA_MAX_PRODUCTS, existingCount);
  return items.slice(0, cap);
}
