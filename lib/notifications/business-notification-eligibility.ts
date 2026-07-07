export type BusinessNotificationEligibilityRow = {
  is_active?: boolean | null | unknown;
  cancellation_effective_at?: string | null | unknown;
};

/** מנוי פעיל — כולל התקופה ששולמה עד cancellation_effective_at (כל עוד is_active=true). */
export function isBusinessSubscriptionActive(
  biz: Pick<BusinessNotificationEligibilityRow, "is_active">
): boolean {
  return biz.is_active === true;
}

/**
 * עסק זכאי להתראות (מייל + וואטסאפ לבעלים) כל עוד המנוי פעיל,
 * כולל התקופה ששולמה עד cancellation_effective_at. בתום התקופה — לא שולחים.
 */
export function isBusinessEligibleForOwnerNotifications(
  biz: BusinessNotificationEligibilityRow,
  nowMs: number = Date.now()
): boolean {
  if (biz.is_active !== true) return false;

  const raw = biz.cancellation_effective_at;
  if (raw == null || raw === "") return true;

  const endMs = new Date(String(raw)).getTime();
  if (!Number.isFinite(endMs)) return true;

  return nowMs < endMs;
}
