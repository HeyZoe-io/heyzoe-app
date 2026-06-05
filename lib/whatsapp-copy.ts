/** הערת תחתית אחידה להודעות זואי (כפתורים/רשימה או טקסט) */
export const ZOE_WHATSAPP_MENU_FOOTER = "ניתן לכתוב שאלה שאינה מופיעה";

export const BUSINESS_INACTIVE_AUTO_REPLY_MODEL = "business_inactive_auto_reply";

export function customerServicePhoneFromSocialLinks(socialLinks: unknown): string {
  if (!socialLinks || typeof socialLinks !== "object" || Array.isArray(socialLinks)) return "";
  const sl = socialLinks as Record<string, unknown>;
  return typeof sl.customer_service_phone === "string" ? sl.customer_service_phone.trim() : "";
}

/** תגובה אוטומטית כשהמנוי אינו פעיל (is_active=false). */
export function buildInactiveBusinessAutoReply(customerServicePhone?: string): string {
  const phone = String(customerServicePhone ?? "").trim();
  if (phone) {
    return `שלום! השירות האוטומטי אינו פעיל. לפרטים נוספים תוכלו ליצור קשר עם שירות הלקוחות ${phone}`;
  }
  return "שלום! השירות האוטומטי אינו פעיל. לפרטים נוספים תוכלו ליצור קשר עם שירות הלקוחות.";
}
