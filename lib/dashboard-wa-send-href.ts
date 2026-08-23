/** ספרות בלבד עם קידומת מדינה, ללא + — לפי הפורמט של wa.me */
export function whatsAppMeDigitsFromDisplay(phoneDisplay: string): string | null {
  const only = String(phoneDisplay ?? "").replace(/\D/g, "");
  if (!only) return null;
  if (only.startsWith("972")) return only;
  if (only.startsWith("0")) return `972${only.slice(1)}`;
  if (only.length === 9) return `972${only}`;
  return only;
}

/** קישור «שלח הודעה» בדשבורד — הטקסט תמיד ב-URL encoding. */
export function whatsAppPrefilledMessageHref(phoneDisplay: string, text: string): string | null {
  const num = whatsAppMeDigitsFromDisplay(phoneDisplay);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}
