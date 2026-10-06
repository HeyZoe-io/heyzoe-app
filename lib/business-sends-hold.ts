/**
 * Per-business outbound hold. Stored on the existing JSON field
 * businesses.social_links.sales_flow.sends_hold.
 * "dry_run": every outbound path still builds the message, logs a would-send,
 * and does not call Meta or Twilio.
 */
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const SENDS_HOLD_DRY_RUN = "dry_run";
export const SENDS_HOLD_ERROR = "sends_hold";

export class SendsHoldError extends Error {
  constructor() {
    super(SENDS_HOLD_ERROR);
    this.name = "SendsHoldError";
  }
}

export function isSendsHoldError(error: unknown): boolean {
  if (error instanceof SendsHoldError) return true;
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text === SENDS_HOLD_ERROR || text.startsWith(`${SENDS_HOLD_ERROR}:`);
}

/** Held template sends stay retryable. They are not a Meta failure. */
export function templateFailureDispatch(error: unknown): "gated" | "send_failed" {
  return isSendsHoldError(error) ? "gated" : "send_failed";
}

export type WouldSendRecord = {
  at: string;
  phone_number_id: string;
  to_masked: string;
  kind: string;
  template_name: string | null;
  preview: string;
};

const wouldSends: WouldSendRecord[] = [];
const holdCache = new Map<string, { held: boolean; at: number }>();
const HOLD_CACHE_MS = 5_000;

type HoldLookup = (phoneNumberId: string) => Promise<boolean>;
let lookupOverride: HoldLookup | null = null;

export function setSendsHoldLookupForTests(fn: HoldLookup | null): void {
  lookupOverride = fn;
  holdCache.clear();
}

export function takeWouldSends(): WouldSendRecord[] {
  return wouldSends.splice(0, wouldSends.length);
}

export function peekWouldSends(): readonly WouldSendRecord[] {
  return wouldSends;
}

export function sendsHoldModeFromSocialLinks(socialLinks: unknown): string | null {
  if (!socialLinks || typeof socialLinks !== "object" || Array.isArray(socialLinks)) return null;
  const sales = (socialLinks as Record<string, unknown>).sales_flow;
  if (!sales || typeof sales !== "object" || Array.isArray(sales)) return null;
  const mode = String((sales as Record<string, unknown>).sends_hold ?? "").trim();
  return mode || null;
}

export function isDryRunSendsHold(socialLinks: unknown): boolean {
  return sendsHoldModeFromSocialLinks(socialLinks) === SENDS_HOLD_DRY_RUN;
}

export function maskSendPhone(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "****";
  return `***${digits.slice(-4)}`;
}

function rememberWouldSend(record: WouldSendRecord): void {
  wouldSends.push(record);
  console.info("[sends-hold] would-send", record);
}

export async function phoneNumberSendsHeld(phoneNumberId: string): Promise<boolean> {
  const id = String(phoneNumberId ?? "").trim();
  if (!id) return false;
  if (lookupOverride) return lookupOverride(id);
  const cached = holdCache.get(id);
  if (cached && Date.now() - cached.at < HOLD_CACHE_MS) return cached.held;
  let held = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data: channel, error: channelErr } = await admin
      .from("whatsapp_channels")
      .select("business_id")
      .eq("phone_number_id", id)
      .limit(1)
      .maybeSingle();
    if (channelErr) {
      console.error("[sends-hold] channel lookup failed", { phone_number_id: id, error: channelErr.message });
      return false;
    }
    const businessId = Number((channel as { business_id?: unknown } | null)?.business_id);
    if (!Number.isFinite(businessId)) {
      holdCache.set(id, { held: false, at: Date.now() });
      return false;
    }
    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("social_links")
      .eq("id", businessId)
      .maybeSingle();
    if (bizErr) {
      console.error("[sends-hold] business lookup failed", { business_id: businessId, error: bizErr.message });
      return false;
    }
    held = isDryRunSendsHold((biz as { social_links?: unknown } | null)?.social_links);
  } catch (e) {
    console.error("[sends-hold] lookup failed", e);
    return false;
  }
  holdCache.set(id, { held, at: Date.now() });
  return held;
}

/** True when this business must not send. Logs the would-send either way. */
export async function outboundSendsHeld(input: {
  phoneNumberId: string;
  to: string;
  kind: string;
  templateName?: string | null;
  preview?: string | null;
}): Promise<boolean> {
  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return false;
  const held = await phoneNumberSendsHeld(phoneNumberId);
  if (!held) return false;
  rememberWouldSend({
    at: new Date().toISOString(),
    phone_number_id: phoneNumberId,
    to_masked: maskSendPhone(input.to),
    kind: input.kind,
    template_name: String(input.templateName ?? "").trim() || null,
    preview: String(input.preview ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
  });
  return true;
}
