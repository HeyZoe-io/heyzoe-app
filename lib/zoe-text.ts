/** מקף ארוך / בינוני → מקף רגיל + תיקוני עברית נפוצים (כל הודעות זואי היוצאות) */
export function sanitizeZoeDashes(text: string): string {
  return String(text ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\bלהטפל\b/gu, "לטפל");
}

/** מחרוזות בתוך payload של Meta (טקסט, כפתורים, כותרות) */
export function sanitizeZoeOutboundDeep<T>(value: T): T {
  if (typeof value === "string") return sanitizeZoeDashes(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeZoeOutboundDeep(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeZoeOutboundDeep(v);
    }
    return out as T;
  }
  return value;
}
