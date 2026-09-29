/** מקסימום תווים לתווית כפתור אינטראקטיבי שזואי שולחת בווטסאפ */
export const WA_BUTTON_LABEL_MAX_CHARS = 23;

/**
 * מגבלת Meta לכותרת כפתור תשובה (1–3 אפשרויות).
 * מתחתיה הטקסט גם לא נחתך בשורת רשימה (4–10), שהמגבלה שלה היא 24.
 */
export const WA_REPLY_BUTTON_TITLE_MAX_CHARS = 20;

/** חיתוך בזמן הקלדה (ללא trim) לאורך שנכנס במלואו לכפתור וואטסאפ */
export function clampWaReplyButtonTitle(value: string): string {
  return [...String(value ?? "")].slice(0, WA_REPLY_BUTTON_TITLE_MAX_CHARS).join("");
}

/** חיתוך בזמן הקלדה (ללא trim) */
export function clampWaButtonLabelInput(value: string): string {
  return [...String(value ?? "")].slice(0, WA_BUTTON_LABEL_MAX_CHARS).join("");
}

/** נרמול לשמירה / שליחה */
export function truncateWaButtonLabel(label: string): string {
  return clampWaButtonLabelInput(String(label ?? "").trim());
}

export function truncateWaButtonLabels(labels: string[]): string[] {
  return labels.map((l) => truncateWaButtonLabel(l)).filter(Boolean);
}
