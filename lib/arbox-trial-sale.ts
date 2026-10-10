/**
 * Which Arbox sale counts as a trial for a business.
 *
 * Off (default): membership_type_id is in businesses.arbox_trial_membership_type_ids.
 * On: that, OR the salesReport row's item_type is "trial". A "session" item is never a
 * trial unless it is in the list. A row without item_type falls back to the list.
 */

/** Top-level `businesses.social_links` key. Survives dashboard saves (prev ⊕ incoming merge). */
export const ARBOX_TRIAL_ITEM_TYPE_SOCIAL_KEY = "arbox_trial_item_type_counts_as_trial";

export type ArboxTrialConfig = {
  trialMembershipTypeIds: readonly number[];
  itemTypeCountsAsTrial: boolean;
};

/** Only a literal `true` turns it on. */
export function arboxTrialItemTypeCountsFromSocial(social: unknown): boolean {
  if (!social || typeof social !== "object" || Array.isArray(social)) return false;
  return (social as Record<string, unknown>)[ARBOX_TRIAL_ITEM_TYPE_SOCIAL_KEY] === true;
}

export function arboxTrialConfig(
  trialMembershipTypeIds: readonly number[] | null | undefined,
  itemTypeCountsAsTrial?: boolean | null
): ArboxTrialConfig {
  return {
    trialMembershipTypeIds: trialMembershipTypeIds ?? [],
    itemTypeCountsAsTrial: itemTypeCountsAsTrial === true,
  };
}

export function isConfiguredArboxTrialMembershipTypeId(
  membershipTypeId: unknown,
  trialMembershipTypeIds: readonly number[] | null | undefined
): boolean {
  if (membershipTypeId == null || membershipTypeId === "") return false;
  const id = Number(membershipTypeId);
  if (!Number.isFinite(id) || id <= 0) return false;
  return (trialMembershipTypeIds ?? []).includes(id);
}

export function isArboxTrialSale(
  row: { membership_type_id?: unknown; item_type?: unknown },
  config: ArboxTrialConfig
): boolean {
  if (isConfiguredArboxTrialMembershipTypeId(row.membership_type_id, config.trialMembershipTypeIds)) {
    return true;
  }
  if (!config.itemTypeCountsAsTrial) return false;
  return String(row.item_type ?? "").trim().toLowerCase() === "trial";
}
