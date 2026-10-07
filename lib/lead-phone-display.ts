import { normalizePhone } from "@/lib/phone-normalize";

export function formatLeadPhoneDisplay(phone: string): string {
  const d = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) return `0${d.slice(3)}`;
  return phone.trim() || "—";
}
