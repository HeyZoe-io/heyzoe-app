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

/**
 * The request may have reached Meta but no answer came back (network error,
 * timeout, an error status without a Meta error body). Never retried automatically.
 */
export const SEND_OUTCOME_UNKNOWN = "send_outcome_unknown";

export function isSendOutcomeUnknown(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text.includes(SEND_OUTCOME_UNKNOWN);
}

/** Meta (or Twilio) answered with a JSON error object: the message was not accepted. */
export function sendErrorBodyIsExplicit(errText: string): boolean {
  const start = errText.indexOf("{");
  if (start < 0) return false;
  try {
    const parsed = JSON.parse(errText.slice(start)) as { error?: unknown; code?: unknown; message?: unknown };
    if (parsed && typeof parsed.error === "object" && parsed.error) return true;
    return parsed?.code != null && typeof parsed?.message === "string";
  } catch {
    return false;
  }
}

/** A send that threw. Explicit only when the error carries the provider's error body. */
export function thrownSendOutcome(error: unknown): "explicit" | "unknown" {
  if (isNonProdSendBlocked(error)) return "explicit";
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/^\[(Meta WA send|Twilio send)\]/.test(text) && sendErrorBodyIsExplicit(text)) return "explicit";
  return "unknown";
}

export async function postWhatsAppGraphMessage(input: {
  phoneNumberId: string;
  to: string;
  token: string;
  body: unknown;
  /** Abort after this many ms. The caller treats an abort as an unknown outcome. */
  timeoutMs?: number;
}): Promise<Response> {
  if (!nonProductionSendAllowed(input.to)) {
    console.error("[non_prod_send_blocked]", {
      recipient_tail: input.to.replace(/\D/g, "").slice(-4),
    });
    throw new NonProdSendBlockedError();
  }
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(input.phoneNumberId.trim())}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
    ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
  });
  if (res.ok) await noteAcceptedSend(res, input);
  return res;
}

/** Hands the wamid to the messages log. Never throws; the caller still reads the body. */
async function noteAcceptedSend(
  res: Response,
  input: { phoneNumberId: string; to: string; body: unknown }
): Promise<void> {
  try {
    const { describeGraphBody, noteOutboundSend, wamidFromGraphResponse } = await import(
      "@/lib/wa-outbound-wamid"
    );
    const wamid = wamidFromGraphResponse(await res.clone().json().catch(() => null));
    if (!wamid) return;
    const rowId = noteOutboundSend({
      phoneNumberId: input.phoneNumberId.trim(),
      to: input.to,
      wamid,
      ...describeGraphBody(input.body),
    });
    if (rowId == null) return;
    const { createSupabaseAdminClient } = await import("@/lib/supabase-admin");
    const { error } = await createSupabaseAdminClient()
      .from("messages")
      .update({ wamid })
      .eq("id", rowId)
      .is("wamid", null);
    if (error) console.error("[graph-whatsapp-send] wamid stamp failed:", error.message);
  } catch (e) {
    console.error("[graph-whatsapp-send] wamid note failed:", e instanceof Error ? e.message : e);
  }
}
