const DEFAULT_SUPPORT_PREFILL = "פנייה לשירות HeyZoe מהשיווק";

/** 3–6 מילים מהודעת המשתמש לטקסט מוכן בשורת ה־WhatsApp (לצוות שירות). */
export function supportWhatsAppPrefillFromUserMessage(userText: string): string {
  const raw = String(userText ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return DEFAULT_SUPPORT_PREFILL;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0) return DEFAULT_SUPPORT_PREFILL;
  const upTo6 = words.slice(0, 6);
  const joined = upTo6.join(" ");
  if (upTo6.length >= 3) return joined.slice(0, 200);
  if (upTo6.length === 2) return `${upTo6[0]} ${upTo6[1]} — פנייה לשירות`.slice(0, 200);
  return `${upTo6[0]} — פנייה לשירות HeyZoe`.slice(0, 200);
}

/** ספרות בלבד ל־wa.me (ללא +), כולל ישראל 0… → 972… */
export function normalizePhoneDigitsForWaMe(input: string): string | null {
  const d = String(input ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("972")) {
    if (d.length >= 11 && d.length <= 13) return d;
    return null;
  }
  if (d.startsWith("0")) {
    const rest = d.slice(1);
    if (rest.length >= 8 && rest.length <= 10) return `972${rest}`;
    return null;
  }
  if (d.startsWith("5") && d.length === 9) return `972${d}`;
  if (d.length >= 10 && d.length <= 15) return d;
  return null;
}

export function buildMarketingSupportWaUrl(phoneRaw: string, prefill: string): string | null {
  const digits = normalizePhoneDigitsForWaMe(phoneRaw);
  if (!digits) return null;
  const t = String(prefill ?? "").trim().slice(0, 180) || DEFAULT_SUPPORT_PREFILL;
  return `https://wa.me/${digits}?text=${encodeURIComponent(t)}`;
}

export function replyContainsMarketingSupportWaLink(reply: string, waUrl: string): boolean {
  const d = waUrl.match(/wa\.me\/(\d+)/i)?.[1];
  if (!d) return false;
  return reply.toLowerCase().includes(`wa.me/${d.toLowerCase()}`);
}
