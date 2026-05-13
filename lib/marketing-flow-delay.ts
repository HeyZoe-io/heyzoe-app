/**
 * השהיה בין הודעות בפלואו השיווקי (אדמין). בפועל מוגבל כדי לא לחרוג מ-timeout של פונקציית ווב.
 * אפשר לעדכן תקרה ב־MARKETING_FLOW_DELAY_MAX_SECONDS (מספר בין 5 ל־120).
 */
export const MARKETING_FLOW_DELAY_MAX_APPLIED_SECONDS_DEFAULT = 45;

function delayMaxApplied(): number {
  if (typeof process === "undefined" || !process.env?.MARKETING_FLOW_DELAY_MAX_SECONDS) {
    return MARKETING_FLOW_DELAY_MAX_APPLIED_SECONDS_DEFAULT;
  }
  const n = Number.parseInt(String(process.env.MARKETING_FLOW_DELAY_MAX_SECONDS).trim(), 10);
  return Number.isFinite(n) && n >= 5 && n <= 120 ? n : MARKETING_FLOW_DELAY_MAX_APPLIED_SECONDS_DEFAULT;
}

/** שניות בפועל אחרי קלמפינג (שרת). */
export function clampMarketingDelaySeconds(raw: unknown): number {
  const max = delayMaxApplied();
  const fromNum =
    typeof raw === "number" && Number.isFinite(raw)
      ? raw
      : Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(fromNum) || fromNum < 1) return Math.min(3, max);
  return Math.min(Math.max(1, Math.floor(fromNum)), max);
}

/** לתצוגה ב־UI (ברירת מחדל; בשרת אפשר להעלות עם MARKETING_FLOW_DELAY_MAX_SECONDS). */
export function marketingDelayMaxForUiHint(): number {
  return MARKETING_FLOW_DELAY_MAX_APPLIED_SECONDS_DEFAULT;
}
