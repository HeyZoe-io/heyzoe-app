/** תוכן הודעת מדיה ידנית ללוג / תצוגה בשיחות (כמו בבוט). */
export function formatManualMediaMessageContent(mediaUrl: string, caption?: string): string {
  const url = mediaUrl.trim();
  const cap = String(caption ?? "").trim();
  if (!url) return cap;
  return cap ? `[media] ${url}\n\n${cap}` : `[media] ${url}`;
}

/** מגביל שליחה ידנית ל-URL ציבורי מ-Supabase Storage (אחרי upload מהדשבורד). */
export function isAllowedManualMediaUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:") return false;
    return u.pathname.includes("/storage/v1/object/public/");
  } catch {
    return false;
  }
}
