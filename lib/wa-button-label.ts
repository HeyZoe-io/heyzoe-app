/** מקסימום תווים לתווית כפתור אינטראקטיבי שזואי שולחת בווטסאפ */
export const WA_BUTTON_LABEL_MAX_CHARS = 23;

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
