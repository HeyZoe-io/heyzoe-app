/**
 * Per-customer mute for one trigger, or for one template that was not sent by a trigger.
 * Marketing opt-out stays on contacts.marketing_opted_out.
 *
 * IO per template send: 1 indexed mute lookup + 1 wamid insert.
 * IO per button tap: 1 wamid lookup + 1 mute insert. No Graph/Claude.
 */
import { canonicalContactPhone, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const SUPPRESSED_ALERT_MUTE_ERROR = "suppressed_alert_mute";

export type AlertMuteRow = {
  trigger_id: string | null;
  template_name: string | null;
};

export function alertMuteMatches(input: {
  rows: readonly AlertMuteRow[];
  triggerId?: string | null;
  templateName: string;
}): boolean {
  const triggerId = String(input.triggerId ?? "").trim();
  const templateName = String(input.templateName ?? "").trim();
  for (const row of input.rows) {
    const rowTrigger = String(row.trigger_id ?? "").trim();
    const rowTemplate = String(row.template_name ?? "").trim();
    if (rowTrigger && triggerId && rowTrigger === triggerId) return true;
    if (!rowTrigger && rowTemplate && !triggerId && rowTemplate === templateName) return true;
  }
  return false;
}

export function isSuppressedAlertMuteError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text === SUPPRESSED_ALERT_MUTE_ERROR || text.includes(SUPPRESSED_ALERT_MUTE_ERROR);
}

function muteTableMissing(message: string): boolean {
  return /contact_alert_mutes|wa_template_send_refs|schema cache|does not exist/i.test(message);
}

function phoneKeys(phone: string): string[] {
  const variants = contactPhoneLookupVariants(phone);
  const canonical = canonicalContactPhone(phone);
  const keys = new Set<string>(variants);
  if (canonical) keys.add(canonical);
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits) keys.add(digits);
  return [...keys];
}

function storedPhone(phone: string): string {
  return canonicalContactPhone(phone) || String(phone ?? "").replace(/\D/g, "");
}

export async function lookupBusinessIdByPhoneNumberId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phoneNumberId: string
): Promise<number | null> {
  const id = String(phoneNumberId ?? "").trim();
  if (!id) return null;
  const { data, error } = await admin
    .from("whatsapp_channels")
    .select("business_id")
    .eq("phone_number_id", id)
    .maybeSingle();
  if (error) {
    console.error("[contact-alert-mute] channel lookup failed:", error.message);
    return null;
  }
  const businessId = Number((data as { business_id?: unknown } | null)?.business_id);
  return Number.isFinite(businessId) && businessId > 0 ? businessId : null;
}

export async function contactAlertMuted(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
  templateName: string;
  triggerId?: string | null;
}): Promise<boolean> {
  const phones = phoneKeys(input.phone);
  if (!input.businessId || !phones.length) return false;
  const { data, error } = await input.admin
    .from("contact_alert_mutes")
    .select("trigger_id, template_name")
    .eq("business_id", input.businessId)
    .in("phone", phones);
  if (error) {
    if (muteTableMissing(error.message)) {
      console.error(
        "[contact-alert-mute] table missing — run supabase/contact_alert_mutes.sql",
        error.message
      );
      return false;
    }
    console.error("[contact-alert-mute] lookup failed:", error.message);
    return false;
  }
  return alertMuteMatches({
    rows: (data ?? []) as AlertMuteRow[],
    triggerId: input.triggerId,
    templateName: input.templateName,
  });
}

export async function recordTemplateSendRef(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  wamid: string;
  businessId: number;
  phone: string;
  templateName: string;
  triggerId?: string | null;
}): Promise<void> {
  const wamid = String(input.wamid ?? "").trim();
  const phone = storedPhone(input.phone);
  const templateName = String(input.templateName ?? "").trim();
  if (!wamid || !input.businessId || !phone || !templateName) return;
  const triggerId = String(input.triggerId ?? "").trim() || null;
  const { error } = await input.admin.from("wa_template_send_refs").insert({
    wamid,
    business_id: input.businessId,
    phone,
    template_name: templateName,
    trigger_id: triggerId,
  });
  if (error && !/duplicate|unique|23505/i.test(error.message)) {
    if (muteTableMissing(error.message)) {
      console.error(
        "[contact-alert-mute] send ref table missing — run supabase/wa_template_send_refs.sql",
        error.message
      );
      return;
    }
    console.error("[contact-alert-mute] send ref insert failed:", error.message);
  }
}

export type TemplateSendRef = {
  businessId: number;
  phone: string;
  templateName: string;
  triggerId: string | null;
};

export async function loadTemplateSendRef(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  wamid: string
): Promise<TemplateSendRef | null> {
  const id = String(wamid ?? "").trim();
  if (!id) return null;
  const { data, error } = await admin
    .from("wa_template_send_refs")
    .select("business_id, phone, template_name, trigger_id")
    .eq("wamid", id)
    .maybeSingle();
  if (error) {
    if (muteTableMissing(error.message)) {
      console.error(
        "[contact-alert-mute] send ref table missing — run supabase/wa_template_send_refs.sql",
        error.message
      );
      return null;
    }
    console.error("[contact-alert-mute] send ref lookup failed:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as {
    business_id?: unknown;
    phone?: unknown;
    template_name?: unknown;
    trigger_id?: unknown;
  };
  const businessId = Number(row.business_id);
  const templateName = String(row.template_name ?? "").trim();
  if (!businessId || !templateName) return null;
  return {
    businessId,
    phone: String(row.phone ?? "").trim(),
    templateName,
    triggerId: String(row.trigger_id ?? "").trim() || null,
  };
}

export async function claimContactAlertMute(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
  templateName: string;
  triggerId?: string | null;
}): Promise<"claimed" | "already" | "error"> {
  const phone = storedPhone(input.phone);
  const templateName = String(input.templateName ?? "").trim();
  const triggerId = String(input.triggerId ?? "").trim() || null;
  if (!input.businessId || !phone || (!triggerId && !templateName)) return "error";

  const phones = phoneKeys(input.phone);
  const base = input.admin
    .from("contact_alert_mutes")
    .select("id")
    .eq("business_id", input.businessId)
    .in("phone", phones);
  const prior = await (triggerId
    ? base.eq("trigger_id", triggerId)
    : base.is("trigger_id", null).eq("template_name", templateName)
  ).limit(1);
  if (prior.error) {
    if (muteTableMissing(prior.error.message)) {
      console.error(
        "[contact-alert-mute] table missing — run supabase/contact_alert_mutes.sql",
        prior.error.message
      );
    } else {
      console.error("[contact-alert-mute] existing lookup failed:", prior.error.message);
    }
    return "error";
  }
  if ((prior.data ?? []).length > 0) return "already";

  const { error } = await input.admin.from("contact_alert_mutes").insert({
    business_id: input.businessId,
    phone,
    trigger_id: triggerId,
    template_name: triggerId ? null : templateName,
  });
  if (error) {
    if (/duplicate|unique|23505/i.test(error.message)) return "already";
    console.error("[contact-alert-mute] insert failed:", error.message);
    return "error";
  }
  console.info("[contact-alert-mute] claimed", {
    business_id: input.businessId,
    trigger_id: triggerId,
    template_name: triggerId ? null : templateName,
  });
  return "claimed";
}

export function graphTemplateMessageId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const messages = (json as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || !messages.length) return null;
  const id = String((messages[0] as { id?: unknown }).id ?? "").trim();
  return id || null;
}
