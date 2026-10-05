/**
 * Global stop for the trial_booked step.
 * ON: the step may send, still subject to the rule activation guard,
 * claim-then-send, and each business's own enabled rule and template.
 */
export const TRIAL_BOOKED_SENDS_ENABLED: boolean = true;

export function trialBookedSendsEnabled(): boolean {
  return TRIAL_BOOKED_SENDS_ENABLED;
}
