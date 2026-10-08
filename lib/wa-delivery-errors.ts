/**
 * Meta delivery error codes in Hebrew, for the conversations tooltip, the admin
 * alerts and the daily summary. Pure: safe in client components.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export type DeliveryState = "sent" | "delivered" | "read" | "failed";

/** What the bubble shows. Highest state wins: failed > read > delivered > sent. */
export type MessageDelivery = {
  status: DeliveryState;
  error_code: number | null;
  error_text: string | null;
};

const RANK: Record<DeliveryState, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export function isDeliveryState(raw: unknown): raw is DeliveryState {
  return typeof raw === "string" && raw in RANK;
}

export function strongerDeliveryState(a: DeliveryState | null, b: DeliveryState): DeliveryState {
  return a && RANK[a] >= RANK[b] ? a : b;
}

const TEMPLATE_ERRORS: Record<number, string> = {
  132000: "מספר הפרמטרים לא תואם לתבנית המאושרת",
  132001: "התבנית לא קיימת בשפה הזו או שעדיין לא אושרה",
  132005: "הטקסט אחרי מילוי הפרמטרים ארוך מדי",
  132007: "התוכן מפר את מדיניות Meta",
  132012: "פורמט הפרמטרים לא תואם לתבנית",
  132015: "התבנית מושהית ב-Meta בגלל איכות נמוכה",
  132016: "התבנית הושבתה ב-Meta בגלל איכות נמוכה",
};

const ERRORS: Record<number, string> = {
  131042: "בעיה בתשלום בחשבון WhatsApp Business של העסק. צריך לעדכן אמצעי תשלום ב-Meta Business",
  131049: "Meta עצרה את ההודעה כדי לא להציף את הנמען בהודעות שיווק. אפשר לנסות שוב בעוד כמה ימים",
  131026: "ההודעה לא נמסרה. ייתכן שהמספר לא בוואטסאפ, שהאפליקציה ישנה, או שהנמען חסם את העסק",
  131047: "עברו יותר מ-24 שעות מההודעה האחרונה של הלקוח. אפשר לשלוח רק תבנית מאושרת",
  131050: "הנמען ביקש להפסיק לקבל הודעות שיווק מהעסק",
  131031: "חשבון WhatsApp Business של העסק נעול ב-Meta",
  368: "חשבון WhatsApp Business של העסק נחסם זמנית בגלל הפרת מדיניות",
  130497: "החשבון מוגבל ולא יכול לשלוח הודעות לנמענים במדינה הזו",
  131045: "מספר הוואטסאפ של העסק לא רשום כמו שצריך ב-Meta (בעיית תעודה או רישום)",
  133010: "מספר הוואטסאפ של העסק לא רשום ב-Meta. צריך לחבר אותו מחדש",
  131048: "Meta הגבילה את השליחה מהמספר בגלל דיווחי ספאם",
  131051: "סוג ההודעה לא נתמך",
  131053: "העלאת המדיה נכשלה",
  130429: "חריגה ממגבלת קצב השליחה של Meta",
};

/** Hebrew explanation for a failed status. Unknown codes get a generic line plus the code. */
export function deliveryErrorHebrew(code: number | null | undefined, title?: string | null): string {
  const n = code == null ? NaN : Number(code);
  if (!Number.isFinite(n)) {
    const t = String(title ?? "").trim();
    return t ? `ההודעה לא נמסרה (${t})` : "ההודעה לא נמסרה. Meta לא החזירה קוד שגיאה";
  }
  const known = ERRORS[n];
  if (known) return `${known} (קוד ${n})`;
  if (n >= 132000 && n < 133000) {
    const detail = TEMPLATE_ERRORS[n];
    return detail ? `בעיה בתבנית: ${detail} (קוד ${n})` : `בעיה בתבנית ההודעה (קוד ${n})`;
  }
  return `ההודעה לא נמסרה. שגיאה מ-Meta (קוד ${n})`;
}

export function deliveryStateLabelHebrew(status: DeliveryState): string {
  if (status === "read") return "נקרא";
  if (status === "delivered") return "נמסר";
  if (status === "failed") return "נכשל";
  return "נשלח";
}

/** One state per wamid from its wa_message_statuses rows. */
export function foldDeliveryStatuses(
  rows: ReadonlyArray<{ wamid?: unknown; status?: unknown; error_code?: unknown; error_title?: unknown }>
): Map<string, MessageDelivery> {
  const out = new Map<string, MessageDelivery>();
  for (const row of rows) {
    const wamid = String(row.wamid ?? "").trim();
    const status = String(row.status ?? "").trim();
    if (!wamid || !isDeliveryState(status)) continue;
    const prev = out.get(wamid);
    const next = strongerDeliveryState(prev?.status ?? null, status);
    if (prev && next === prev.status) continue;
    const code = row.error_code == null ? null : Number(row.error_code);
    const errorCode = status === "failed" && Number.isFinite(code) ? (code as number) : null;
    out.set(wamid, {
      status: next,
      error_code: errorCode,
      error_text:
        status === "failed" ? deliveryErrorHebrew(errorCode, String(row.error_title ?? "") || null) : null,
    });
  }
  return out;
}
