/**
 * A contact Zoe's sales flow already registered (trial_registered, or the
 * conversation reached session_phase registered). not_registered_after_trial
 * and missed_trial skip them, not only people with an Arbox purchase.
 */
export const REGISTERED_VIA_ZOE_REASON = "registered_via_zoe";

export function registeredViaZoe(
  contact: { trial_registered?: boolean | null; session_phase?: string | null } | null | undefined
): boolean {
  if (!contact) return false;
  return contact.trial_registered === true || String(contact.session_phase ?? "").trim() === "registered";
}
