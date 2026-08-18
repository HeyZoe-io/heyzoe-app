import { MARKETING_PHONE_WA_ME } from "@/lib/marketing-whatsapp";

export const WA_UNSUPPORTED_LOG_PREFIX = "[unsupported]";
export const WA_ZOE_ADMIN_TEMPLATE_MODEL = "wa_zoe_admin_template";

const TEMPLATE_KINDS = new Set(["unsupported", "unknown", "hsm", "template", "interactive"]);

function marketingLineDigits(): string {
  return String(MARKETING_PHONE_WA_ME ?? "").replace(/\D/g, "");
}

/** 03-382-4981 → 97233824981 (קו זואי אדמין הוא קווי, לא 05). */
export function digitsForMarketingLineCompare(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return `972${d.slice(1)}`;
  return d;
}

export function isZoeAdminWhatsAppPhone(phone: string): boolean {
  const want = marketingLineDigits();
  const got = digitsForMarketingLineCompare(phone);
  return Boolean(want && got && got === want);
}

export function isWaUnsupportedLogContent(raw: string): boolean {
  return /^\[unsupported\]/i.test(String(raw ?? "").trim());
}

export function formatWaUnsupportedLogContent(kind: string, preview?: string): string {
  const k = String(kind ?? "").trim() || "unknown";
  const p = String(preview ?? "").trim();
  if (p) return p;
  return `${WA_UNSUPPORTED_LOG_PREFIX} ${k}`;
}

export function parseWaUnsupportedKind(raw: string): string | null {
  const s = String(raw ?? "").trim();
  const m = /^\[unsupported\]\s*(.*)$/i.exec(s);
  if (!m) return null;
  return (m[1] ?? "").trim() || "unsupported";
}

export function unsupportedKindIsTemplate(kind: string): boolean {
  const k = String(kind ?? "").trim().toLowerCase();
  return !k || TEMPLATE_KINDS.has(k);
}

export function hebrewUnsupportedInboundLabel(kind: string): { title: string; detail: string } {
  const k = String(kind ?? "").trim().toLowerCase();
  if (unsupportedKindIsTemplate(k)) {
    return {
      title: "הודעת תבנית מוואטסאפ",
      detail: "Meta לא מעבירה את תוכן ההודעה בין שני מספרי עסק",
    };
  }
  if (k === "image") return { title: "תמונה", detail: "סוג הודעה לא נתמך בתצוגה" };
  if (k === "video") return { title: "וידאו", detail: "סוג הודעה לא נתמך בתצוגה" };
  if (k === "audio" || k === "voice") return { title: "הקלטה", detail: "סוג הודעה לא נתמך בתצוגה" };
  if (k === "sticker") return { title: "סטיקר", detail: "סוג הודעה לא נתמך בתצוגה" };
  if (k === "document") return { title: "קובץ", detail: "סוג הודעה לא נתמך בתצוגה" };
  if (k === "poll" || k === "poll_creation") return { title: "סקר", detail: "Meta לא מעבירה סקרים ל-Cloud API" };
  if (k === "location") return { title: "מיקום", detail: "סוג הודעה לא נתמך בתצוגה" };
  if (k === "contacts") return { title: "איש קשר", detail: "סוג הודעה לא נתמך בתצוגה" };
  return {
    title: "הודעה לא נתמכת",
    detail: k && k !== "unknown" ? k : "Meta לא העבירה את תוכן ההודעה",
  };
}
