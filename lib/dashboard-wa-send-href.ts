/** ספרות בלבד עם קידומת מדינה, ללא + — לפי הפורמט של wa.me */
export function whatsAppMeDigitsFromDisplay(phoneDisplay: string): string | null {
  const only = String(phoneDisplay ?? "").replace(/\D/g, "");
  if (!only) return null;
  if (only.startsWith("972")) return only;
  if (only.startsWith("0")) return `972${only.slice(1)}`;
  if (only.length === 9) return `972${only}`;
  return only;
}

/** טקסט קבוע לכפתור «שלח הודעה» בדשבורד — טריגר פלואו המכירה. */
export const DASHBOARD_WA_SEND_PREFILL = "אשמח לפרטים";

/** אותו טקסט אחרי encodeURIComponent — לא «היי». */
export const DASHBOARD_WA_SEND_PREFILL_QUERY =
  "%D7%90%D7%A9%D7%9E%D7%97%20%D7%9C%D7%A4%D7%A8%D7%98%D7%99%D7%9D";

/** קישור «שלח הודעה» — מספר דינמי, פריפיל קבוע ומקודד. */
export function dashboardWhatsAppSendHref(phoneDisplay: string): string | null {
  const num = whatsAppMeDigitsFromDisplay(phoneDisplay);
  if (!num) return null;
  return `https://wa.me/${num}?text=${DASHBOARD_WA_SEND_PREFILL_QUERY}`;
}
