/**
 * Atomic duplicate guard for sendBusinessTemplate: claim (business, phone, template) for 20h
 * before the Graph call. supabase/wa_template_send_claims.sql.
 * Broadcast / bulk / non-event templates: independent of params.
 * Event-scoped sends (class reminder, class cancelled, booking confirmation, trainer heads-up, …)
 * claim template + event key, so two events for one phone each go out once.
 *
 * IO per automated send: one RPC. Only when the claim is held: one slug read + one indexed
 * revoke read (messages business_slug, session_id, role, created_at), and a second RPC if a
 * WhatsApp Business revoke came after the claim. Explicit Meta failure: one delete.
 * Before the SQL runs: the previous messages lookup (findRecentAutomatedTemplateSend).
 */
import { randomUUID } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildWaSessionId } from "@/lib/phone-normalize";
import {
  findRecentAutomatedTemplateSend,
  TEMPLATE_DUPLICATE_WINDOW_MS,
} from "@/lib/notifications/template-duplicate-guard";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const TEMPLATE_SEND_CLAIMS_TABLE = "wa_template_send_claims";

export type TemplateSendClaim =
  | { kind: "claimed"; token: string; key: { business_id: number; phone: string; template_name: string } }
  | { kind: "duplicate" }
  /** RPC missing or failed: the send goes on (the old guard already ran when possible). */
  | { kind: "unclaimed" };

/** Per-phone (not per-event) dedup keys: these keep the param-independent claim. */
const PHONE_SCOPED_DEDUP_PREFIXES = new Set(["site_lead", "no_response"]);

/**
 * Event identity from a trigger's per-event dedup key (`kind:business:trigger:event…`).
 * Business and trigger are dropped: the immediate path and the queued path of one event
 * get the same key, and two rules on the same event with the same template still collide.
 * null = not an event-scoped send.
 */
export function templateClaimEventKey(dedupKey: unknown): string | null {
  const raw = String(dedupKey ?? "").trim();
  const parts = raw.split(":");
  if (parts.length < 4) return null;
  const [kind, , , ...event] = parts;
  if (!kind || PHONE_SCOPED_DEDUP_PREFIXES.has(kind)) return null;
  const rest = event.join(":").trim();
  return rest ? `${kind}:${rest}` : null;
}

/** wa_template_send_claims.template_name: the template, plus the event key when event-scoped. */
export function templateClaimName(templateName: string, eventKey: string | null | undefined): string {
  const name = templateName.trim();
  const event = String(eventKey ?? "").trim();
  return event ? `${name}#${event}` : name;
}

export function claimPhoneKey(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function isMissingClaimRpc(error: { code?: string; message?: string }): boolean {
  return (
    String(error.code ?? "") === "PGRST202" ||
    String(error.code ?? "") === "42883" ||
    /could not find the function|claim_template_send|wa_template_send_claims/i.test(String(error.message ?? ""))
  );
}

async function latestRevokeAt(input: {
  admin: Admin;
  businessId: number;
  phoneNumberId: string;
  phone: string;
  since: string;
}): Promise<string | null> {
  const sessionId = buildWaSessionId(input.phoneNumberId, input.phone);
  if (!sessionId) return null;
  const { data: biz } = await input.admin.from("businesses").select("slug").eq("id", input.businessId).maybeSingle();
  const slug = String((biz as { slug?: unknown } | null)?.slug ?? "").trim();
  if (!slug) return null;
  const { data, error } = await input.admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", slug)
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .eq("model_used", "wa_business_app")
    .eq("content", "[revoke]")
    .gte("created_at", input.since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[template-send-claim] revoke lookup failed", error.message);
    return null;
  }
  return String((data?.[0] as { created_at?: unknown } | undefined)?.created_at ?? "") || null;
}

export async function claimTemplateSend(input: {
  admin: Admin;
  businessId: number;
  phoneNumberId: string;
  phone: string;
  templateName: string;
  params: readonly string[];
  /** templateClaimEventKey(dedupKey). Empty = param-independent claim. */
  eventKey?: string | null;
  now?: Date;
}): Promise<TemplateSendClaim> {
  const phone = claimPhoneKey(input.phone);
  const templateName = input.templateName.trim();
  if (!phone || !templateName || !input.businessId) return { kind: "unclaimed" };
  const token = randomUUID();
  const claimName = templateClaimName(templateName, input.eventKey);
  const key = { business_id: input.businessId, phone, template_name: claimName };
  const rpc = (reclaimBefore: string | null) =>
    input.admin.rpc("claim_template_send", {
      p_business_id: input.businessId,
      p_phone: phone,
      p_template_name: claimName,
      p_token: token,
      p_window_seconds: Math.round(TEMPLATE_DUPLICATE_WINDOW_MS / 1000),
      p_reclaim_before: reclaimBefore,
    });

  const first = await rpc(null);
  if (first.error) {
    if (!isMissingClaimRpc(first.error)) {
      console.error("[template-send-claim] claim failed, using messages lookup", first.error.message);
    }
    const duplicate = await findRecentAutomatedTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      phoneNumberId: input.phoneNumberId,
      phone: input.phone,
      templateName,
      params: input.params,
      now: input.now,
    }).catch((e) => {
      console.error("[template-send-claim] fallback guard failed", e);
      return false;
    });
    return duplicate ? { kind: "duplicate" } : { kind: "unclaimed" };
  }
  if (first.data === true) return { kind: "claimed", token, key };

  const since = new Date((input.now ?? new Date()).getTime() - TEMPLATE_DUPLICATE_WINDOW_MS).toISOString();
  const revokedAt = await latestRevokeAt({
    admin: input.admin,
    businessId: input.businessId,
    phoneNumberId: input.phoneNumberId,
    phone: input.phone,
    since,
  });
  if (!revokedAt) return { kind: "duplicate" };
  const again = await rpc(revokedAt);
  if (!again.error && again.data === true) return { kind: "claimed", token, key };
  if (again.error) console.error("[template-send-claim] re-claim after revoke failed", again.error.message);
  return { kind: "duplicate" };
}

/** Explicit Meta failure: nothing reached the customer, so the next attempt may claim. */
export async function releaseTemplateSendClaim(admin: Admin, claim: TemplateSendClaim): Promise<void> {
  if (claim.kind !== "claimed") return;
  const { error } = await admin
    .from(TEMPLATE_SEND_CLAIMS_TABLE)
    .delete()
    .eq("business_id", claim.key.business_id)
    .eq("phone", claim.key.phone)
    .eq("template_name", claim.key.template_name)
    .eq("claim_token", claim.token);
  if (error) console.error("[template-send-claim] release failed", error.message);
}
