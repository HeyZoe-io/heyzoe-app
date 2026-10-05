/**
 * What a trial registration sends.
 *
 * A calendar booking sends every enabled trial_booked template, and also the
 * free sales-flow message when the contact is inside the 24h window.
 * A trial purchase never sends a purchase template. The free message is sent
 * at most once per contact, from whichever path happens first.
 * A trial purchase with no booking yet sends only that free message (if in
 * the window). The trial_booked templates wait until a booking appears.
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
      freeMessage: input.inWindow && !input.freeAlreadySent,
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
