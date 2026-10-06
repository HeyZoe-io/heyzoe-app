/**
 * What a trial registration sends.
 *
 * A calendar booking sends every enabled trial_booked template, and does not
 * also send the free sales-flow registration text. That text is only for a
 * trial purchase that has no booking yet, once per contact, inside the 24h
 * window. A trial purchase never sends a purchase template. The templates
 * wait until a booking appears.
 */
export type TrialRegistrationPlan = {
  freeMessage: boolean;
  trialBookedTemplates: number;
  purchaseTemplates: number;
};

export function planTrialRegistrationSends(input: {
  source: "booking" | "purchase";
  isTrialProduct: boolean;
  inWindow: boolean;
  freeAlreadySent: boolean;
  classStarted: boolean;
  trialBookedRuleCount: number;
  purchaseRuleCount: number;
}): TrialRegistrationPlan {
  const trialBooked = Math.max(0, input.trialBookedRuleCount);
  const purchase = Math.max(0, input.purchaseRuleCount);
  if (input.source === "booking") {
    if (input.classStarted) {
      return { freeMessage: false, trialBookedTemplates: 0, purchaseTemplates: 0 };
    }
    return {
      freeMessage: input.inWindow && !input.freeAlreadySent && trialBooked === 0,
      trialBookedTemplates: trialBooked,
      purchaseTemplates: 0,
    };
  }
  if (input.isTrialProduct) {
    return {
      freeMessage: input.inWindow && !input.freeAlreadySent,
      trialBookedTemplates: 0,
      purchaseTemplates: 0,
    };
  }
  return { freeMessage: false, trialBookedTemplates: 0, purchaseTemplates: purchase };
}
