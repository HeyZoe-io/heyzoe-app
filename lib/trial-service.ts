/** מקסימום תווים לשם שירות/אימון ניסיון — כפתורי WhatsApp קצרים */
export const TRIAL_SERVICE_NAME_MAX_CHARS = 15;

export function truncateTrialServiceName(name: string): string {
  const t = name.trim();
  if (!t) return "";
  return [...t].slice(0, TRIAL_SERVICE_NAME_MAX_CHARS).join("");
}
