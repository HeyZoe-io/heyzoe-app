/**
 * Global stop for the trial_booked step.
 * Default OFF: the step sends nothing for every business, even if a rule
 * or template is turned back on.
 * Stays off until the dedup migration is live and Step 6 verification passes.
 */
export const TRIAL_BOOKED_SENDS_ENABLED: boolean = false;

export function trialBookedSendsEnabled(): boolean {
  return TRIAL_BOOKED_SENDS_ENABLED;
}
