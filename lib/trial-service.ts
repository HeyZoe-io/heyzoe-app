export {
  WA_BUTTON_LABEL_MAX_CHARS as TRIAL_SERVICE_NAME_MAX_CHARS,
  truncateWaButtonLabel as truncateTrialServiceName,
} from "@/lib/wa-button-label";

/** רשימת בחירה בווטסאפ — עד 10 שורות (Meta list). */
export const WA_MAX_PRODUCTS = 10;

/** תקרה לדשבורד/סריקה — מעבר לזה לא שומרים כדי לא לפוצץ את הטופס. */
export const DASHBOARD_MAX_PRODUCTS = 40;

/** אינדקס 0-based: מ־10 ומעלה לא נשלח כשורת בחירה בווטסאפ. */
export function isWhatsAppChatOverflowIndex(index: number): boolean {
  return index >= WA_MAX_PRODUCTS;
}

/** עשרת המוצרים הראשונים בסדר הרשימה — מה שזואי שולחת בצ׳אט. */
export function capWhatsAppProducts<T>(items: T[]): T[] {
  return items.slice(0, WA_MAX_PRODUCTS);
}
