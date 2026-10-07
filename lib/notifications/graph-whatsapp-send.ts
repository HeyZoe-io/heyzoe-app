/**
 * Single Graph /messages call. Outside production only the test handset may be sent to.
 * The check runs before fetch, independent of dry-run, clock, and caller.
 */
export const NON_PROD_SEND_PHONE = "972508318162";
export const NON_PROD_SEND_BLOCKED = "non_prod_send_blocked";

export class NonProdSendBlockedError extends Error {
  constructor() {
    super(NON_PROD_SEND_BLOCKED);
    this.name = "NonProdSendBlockedError";
  }
}

export function isNonProdSendBlocked(error: unknown): boolean {
  if (error instanceof NonProdSendBlockedError) return true;
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text === NON_PROD_SEND_BLOCKED;
}

/** Production sends to anyone. Every other environment sends only to the test phone. */
export function nonProductionSendAllowed(to: string): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return to.replace(/\D/g, "") === NON_PROD_SEND_PHONE;
}

export async function postWhatsAppGraphMessage(input: {
  phoneNumberId: string;
  to: string;
  token: string;
  body: unknown;
}): Promise<Response> {
  if (!nonProductionSendAllowed(input.to)) {
    console.error("[non_prod_send_blocked]", {
      recipient_tail: input.to.replace(/\D/g, "").slice(-4),
    });
    throw new NonProdSendBlockedError();
  }
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(input.phoneNumberId.trim())}/messages`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
  });
}
