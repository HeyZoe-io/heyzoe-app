/**
 * Meta marketing-message opt-out (Stop promotions).
 * Distinct from contacts.opted_out (inbound «הסר» — full stop including Zoe).
 *
 * IO: webhook or failed send → 1 channel lookup + 1 contacts update/insert.
 * No extra Graph/Claude calls. No cron.
 */
import { canonicalContactPhone, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const MARKETING_OPT_OUT_ERROR_CODE = 131050;

export type MarketingOptOutSource = "user_preferences" | "error_131050";

export type UserPreferenceEvent = {
  phoneNumberId: string;
  waId: string;
  preference: "stop" | "resume";
  category: string;
};

export type MarketingOptOutStatusEvent = {
  phoneNumberId: string;
  recipientPhone: string;
};

/** Queue/drain last_error when a lead is suppressed for opt-out. */
export const SUPPRESSED_OPT_OUT_ERROR = "suppressed_opt_out";

export type ContactSendFlags = {
  optedOut: boolean;
  marketingOptedOut: boolean;
};

/** Missing category is treated as MARKETING (safer). */
export function isMarketingTemplateCategory(raw: unknown): boolean {
  const cat = String(raw ?? "")
    .trim()
    .toUpperCase();
  return !cat || cat === "MARKETING";
}

export function shouldSuppressLeadTemplate(input: {
  category: unknown;
  optedOut: boolean;
  marketingOptedOut: boolean;
}): boolean {
  if (input.optedOut) return true;
  return isMarketingTemplateCategory(input.category) && input.marketingOptedOut;
}

export function shouldSuppressSessionMessage(optedOut: boolean): boolean {
  return optedOut === true;
}

export function contactBlocksMarketingBulk(contact: {
  opted_out?: boolean | null;
  marketing_opted_out?: boolean | null;
}): boolean {
  return shouldSuppressLeadTemplate({
    category: "MARKETING",
    optedOut: contact.opted_out === true,
    marketingOptedOut: contact.marketing_opted_out === true,
  });
}

export function isMarketingOptOutErrorCode(code: unknown): boolean {
  return Number(code) === MARKETING_OPT_OUT_ERROR_CODE;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

/** Graph error body or nested `{ error: { code } }`. */
export function extractMetaErrorCode(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return extractMetaErrorCode(JSON.parse(trimmed) as unknown);
    } catch {
      const hash = /\(#(\d{5,6})\)/.exec(trimmed);
      if (hash) return Number(hash[1]);
      return null;
    }
  }
  const obj = asRecord(raw);
  if (!obj) return null;
  const err = asRecord(obj.error) ?? obj;
  const code = Number(err.code);
  if (Number.isFinite(code) && code > 0) return Math.trunc(code);
  const sub = Number(err.error_subcode);
  if (Number.isFinite(sub) && sub > 0) return Math.trunc(sub);
  return null;
}

function wabaEntries(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root || root.object !== "whatsapp_business_account") return [];
  return Array.isArray(root.entry) ? (root.entry as Record<string, unknown>[]) : [];
}

function preferenceFromRaw(raw: unknown): "stop" | "resume" | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "stop") return "stop";
  if (v === "resume") return "resume";
  return null;
}

/**
 * Parse `field: user_preferences` even when there is no inbound message.
 * `wa_id` may be empty (username feature) — caller logs and skips.
 */
export function parseUserPreferencesWebhook(payload: unknown): UserPreferenceEvent[] {
  const out: UserPreferenceEvent[] = [];
  for (const entry of wabaEntries(payload)) {
    const changes = Array.isArray(entry.changes) ? (entry.changes as unknown[]) : [];
    for (const change of changes) {
      const ch = asRecord(change);
      if (!ch) continue;
      if (String(ch.field ?? "").trim() !== "user_preferences") continue;
      const value = asRecord(ch.value);
      if (!value) continue;
      const phoneNumberId = String(
        (asRecord(value.metadata) ?? {}).phone_number_id ?? ""
      ).trim();
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const fallbackWaId = contacts
        .map((c) => String((asRecord(c) ?? {}).wa_id ?? "").trim())
        .find(Boolean) ?? "";
      const prefs = Array.isArray(value.user_preferences) ? value.user_preferences : [];
      for (const rawPref of prefs) {
        const pref = asRecord(rawPref);
        if (!pref) continue;
        const category = String(pref.category ?? "").trim() || "marketing_messages";
        if (category !== "marketing_messages") continue;
        const preference = preferenceFromRaw(pref.value);
        if (!preference) continue;
        const waId = String(pref.wa_id ?? "").trim() || fallbackWaId;
        out.push({ phoneNumberId, waId, preference, category });
      }
    }
  }
  return out;
}

/** Failed `messages` statuses with code 131050 (async Graph delivery). */
export function parseMarketingOptOutStatuses(payload: unknown): MarketingOptOutStatusEvent[] {
  const out: MarketingOptOutStatusEvent[] = [];
  for (const entry of wabaEntries(payload)) {
    const changes = Array.isArray(entry.changes) ? (entry.changes as unknown[]) : [];
    for (const change of changes) {
      const ch = asRecord(change);
      if (!ch) continue;
      const value = asRecord(ch.value);
      if (!value) continue;
      const phoneNumberId = String(
        (asRecord(value.metadata) ?? {}).phone_number_id ?? ""
      ).trim();
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const rawStatus of statuses) {
        const st = asRecord(rawStatus);
        if (!st) continue;
        if (String(st.status ?? "").trim().toLowerCase() !== "failed") continue;
        const errors = Array.isArray(st.errors) ? st.errors : [];
        const hit = errors.some((e) => isMarketingOptOutErrorCode((asRecord(e) ?? {}).code));
        if (!hit) continue;
        const recipientPhone = String(st.recipient_id ?? "").trim();
        if (!phoneNumberId || !recipientPhone) continue;
        out.push({ phoneNumberId, recipientPhone });
      }
    }
  }
  return out;
}

function isMissingMarketingOptOutColumn(message: string): boolean {
  return /marketing_opted_out|column|schema cache/i.test(message);
}

async function lookupBusinessIdForPhoneNumberId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phoneNumberId: string
): Promise<number | null> {
  const { data, error } = await admin
    .from("whatsapp_channels")
    .select("business_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) {
    console.error("[wa-marketing-opt-out] channel lookup failed:", error.message, {
      phone_number_id: phoneNumberId,
    });
    return null;
  }
  const id = Number((data as { business_id?: unknown } | null)?.business_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function setContactMarketingOptedOut(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
  optedOut: boolean;
  source: MarketingOptOutSource;
}): Promise<"updated" | "inserted" | "unchanged" | "skipped" | "error"> {
  const phone = canonicalContactPhone(input.phone) ?? String(input.phone ?? "").replace(/\D/g, "");
  if (!phone) {
    console.error("[wa-marketing-opt-out] skip — empty phone", {
      source: input.source,
      business_id: input.businessId,
    });
    return "skipped";
  }
  const variants = contactPhoneLookupVariants(phone);
  const lookup = variants.length ? variants : [phone];
  const nowIso = new Date().toISOString();

  const { data: existingRows, error: loadErr } = await input.admin
    .from("contacts")
    .select("id, phone, marketing_opted_out, opted_out")
    .eq("business_id", input.businessId)
    .in("phone", lookup)
    .limit(1);
  if (loadErr) {
    if (isMissingMarketingOptOutColumn(loadErr.message)) {
      console.error(
        "[wa-marketing-opt-out] contacts.marketing_opted_out missing — run supabase/contacts_marketing_opted_out.sql"
      );
      return "error";
    }
    console.error("[wa-marketing-opt-out] contact lookup failed:", loadErr.message);
    return "error";
  }

  const existing = existingRows?.[0] as
    | { id?: unknown; phone?: unknown; marketing_opted_out?: unknown; opted_out?: unknown }
    | undefined;

  if (existing?.id) {
    const already = existing.marketing_opted_out === true;
    if (input.optedOut === already) return "unchanged";
    const { error: updErr } = await input.admin
      .from("contacts")
      .update({ marketing_opted_out: input.optedOut, updated_at: nowIso })
      .eq("id", existing.id);
    if (updErr) {
      if (isMissingMarketingOptOutColumn(updErr.message)) {
        console.error(
          "[wa-marketing-opt-out] contacts.marketing_opted_out missing — run supabase/contacts_marketing_opted_out.sql"
        );
        return "error";
      }
      console.error("[wa-marketing-opt-out] contact update failed:", updErr.message);
      return "error";
    }
    console.info("[wa-marketing-opt-out] contact updated", {
      business_id: input.businessId,
      source: input.source,
      marketing_opted_out: input.optedOut,
      keyword_opted_out: existing.opted_out === true,
    });
    return "updated";
  }

  if (!input.optedOut) return "unchanged";

  const { error: insErr } = await input.admin.from("contacts").insert({
    business_id: input.businessId,
    phone,
    source: "meta_opt_out",
    marketing_opted_out: true,
    updated_at: nowIso,
  });
  if (insErr) {
    if (isMissingMarketingOptOutColumn(insErr.message)) {
      console.error(
        "[wa-marketing-opt-out] contacts.marketing_opted_out missing — run supabase/contacts_marketing_opted_out.sql"
      );
      return "error";
    }
    if (/duplicate|unique|23505/i.test(insErr.message)) {
      const { error: retryErr } = await input.admin
        .from("contacts")
        .update({ marketing_opted_out: true, updated_at: nowIso })
        .eq("business_id", input.businessId)
        .in("phone", lookup);
      if (retryErr) {
        console.error("[wa-marketing-opt-out] contact race update failed:", retryErr.message);
        return "error";
      }
      return "updated";
    }
    console.error("[wa-marketing-opt-out] contact insert failed:", insErr.message);
    return "error";
  }
  console.info("[wa-marketing-opt-out] contact inserted", {
    business_id: input.businessId,
    source: input.source,
  });
  return "inserted";
}

export async function applyMarketingOptOutForPhoneNumber(input: {
  phoneNumberId: string;
  phone: string;
  optedOut: boolean;
  source: MarketingOptOutSource;
}): Promise<"updated" | "inserted" | "unchanged" | "skipped" | "error"> {
  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  if (!phoneNumberId) {
    console.error("[wa-marketing-opt-out] skip — missing phone_number_id", { source: input.source });
    return "skipped";
  }
  const admin = createSupabaseAdminClient();
  const businessId = await lookupBusinessIdForPhoneNumberId(admin, phoneNumberId);
  if (!businessId) {
    console.error("[wa-marketing-opt-out] no channel for phone_number_id", {
      phone_number_id: phoneNumberId,
      source: input.source,
    });
    return "skipped";
  }
  return setContactMarketingOptedOut({
    admin,
    businessId,
    phone: input.phone,
    optedOut: input.optedOut,
    source: input.source,
  });
}

export async function handleMarketingOptOutWebhookSignals(input: {
  prefs: UserPreferenceEvent[];
  statuses: MarketingOptOutStatusEvent[];
}): Promise<void> {
  for (const pref of input.prefs) {
    if (!pref.phoneNumberId) {
      console.error("[wa-marketing-opt-out] user_preferences missing phone_number_id");
      continue;
    }
    if (!pref.waId) {
      console.error("[wa-marketing-opt-out] user_preferences missing wa_id (username?) — wait for 131050", {
        preference: pref.preference,
      });
      continue;
    }
    await applyMarketingOptOutForPhoneNumber({
      phoneNumberId: pref.phoneNumberId,
      phone: pref.waId,
      optedOut: pref.preference === "stop",
      source: "user_preferences",
    });
  }
  for (const st of input.statuses) {
    await applyMarketingOptOutForPhoneNumber({
      phoneNumberId: st.phoneNumberId,
      phone: st.recipientPhone,
      optedOut: true,
      source: "error_131050",
    });
  }
}

export async function suppressMarketingOptOutFromSendError(input: {
  phoneNumberId: string;
  phone: string;
  errorText: string | null | undefined;
}): Promise<void> {
  if (!isMarketingOptOutErrorCode(extractMetaErrorCode(input.errorText))) return;
  await applyMarketingOptOutForPhoneNumber({
    phoneNumberId: input.phoneNumberId,
    phone: input.phone,
    optedOut: true,
    source: "error_131050",
  });
}

export async function loadContactSendFlags(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  phone: string
): Promise<ContactSendFlags> {
  const variants = contactPhoneLookupVariants(phone);
  const lookup = variants.length ? variants : [String(phone ?? "").trim()].filter(Boolean);
  if (!lookup.length) return { optedOut: false, marketingOptedOut: false };

  const full = await admin
    .from("contacts")
    .select("opted_out, marketing_opted_out")
    .eq("business_id", businessId)
    .in("phone", lookup)
    .limit(1)
    .maybeSingle();
  if (full.error && isMissingMarketingOptOutColumn(full.error.message)) {
    const fallback = await admin
      .from("contacts")
      .select("opted_out")
      .eq("business_id", businessId)
      .in("phone", lookup)
      .limit(1)
      .maybeSingle();
    if (fallback.error) {
      console.error("[wa-send-suppression] contact flags lookup failed:", fallback.error.message);
      return { optedOut: false, marketingOptedOut: false };
    }
    return {
      optedOut: (fallback.data as { opted_out?: boolean } | null)?.opted_out === true,
      marketingOptedOut: false,
    };
  }
  if (full.error) {
    console.error("[wa-send-suppression] contact flags lookup failed:", full.error.message);
    return { optedOut: false, marketingOptedOut: false };
  }
  const row = full.data as { opted_out?: boolean; marketing_opted_out?: boolean } | null;
  if (!row) return { optedOut: false, marketingOptedOut: false };
  return {
    optedOut: row.opted_out === true,
    marketingOptedOut: row.marketing_opted_out === true,
  };
}

export async function loadWhatsappTemplateCategory(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  templateName: string
): Promise<string | null> {
  const name = String(templateName ?? "").trim();
  if (!name) return null;
  const { data, error } = await admin
    .from("whatsapp_templates")
    .select("category")
    .eq("business_id", businessId)
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[wa-send-suppression] template category lookup failed:", error.message);
    return null;
  }
  const cat = String((data as { category?: unknown } | null)?.category ?? "").trim();
  return cat || null;
}

export async function evaluateLeadTemplateSend(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
  category?: unknown;
  templateName?: string;
}): Promise<{ suppress: boolean; flags: ContactSendFlags; category: string | null }> {
  const flags = await loadContactSendFlags(input.admin, input.businessId, input.phone);
  let category =
    input.category !== undefined && input.category !== null && String(input.category).trim()
      ? String(input.category).trim()
      : null;
  if (!category && input.templateName) {
    category = await loadWhatsappTemplateCategory(input.admin, input.businessId, input.templateName);
  }
  return {
    suppress: shouldSuppressLeadTemplate({
      category,
      optedOut: flags.optedOut,
      marketingOptedOut: flags.marketingOptedOut,
    }),
    flags,
    category,
  };
}

export async function evaluateLeadTemplateSendByPhoneNumberId(input: {
  phoneNumberId: string;
  phone: string;
  templateName: string;
}): Promise<{ suppress: boolean }> {
  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return { suppress: false };
  const admin = createSupabaseAdminClient();
  const businessId = await lookupBusinessIdForPhoneNumberId(admin, phoneNumberId);
  if (!businessId) return { suppress: false };
  const result = await evaluateLeadTemplateSend({
    admin,
    businessId,
    phone: input.phone,
    templateName: input.templateName,
  });
  return { suppress: result.suppress };
}

export async function loadMarketingWhatsappTemplateCategory(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  templateName: string
): Promise<string | null> {
  const name = String(templateName ?? "").trim();
  if (!name) return null;
  const { data, error } = await admin
    .from("marketing_whatsapp_templates")
    .select("category")
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!/does not exist|schema cache|marketing_whatsapp_templates/i.test(error.message)) {
      console.error("[wa-send-suppression] marketing template category lookup failed:", error.message);
    }
    return null;
  }
  const cat = String((data as { category?: unknown } | null)?.category ?? "").trim();
  return cat || null;
}

/** HeyZoe ads/marketing WABA: check flags only if a contact row exists for that line's business. */
export async function evaluateMarketingLineTemplateSend(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  phoneNumberId: string;
  phone: string;
  templateName: string;
}): Promise<{ suppress: boolean; flags: ContactSendFlags; category: string | null }> {
  const businessId = await lookupBusinessIdForPhoneNumberId(input.admin, input.phoneNumberId);
  if (!businessId) {
    return {
      suppress: false,
      flags: { optedOut: false, marketingOptedOut: false },
      category: null,
    };
  }
  const marketingCategory = await loadMarketingWhatsappTemplateCategory(
    input.admin,
    input.templateName
  );
  return evaluateLeadTemplateSend({
    admin: input.admin,
    businessId,
    phone: input.phone,
    category: marketingCategory ?? undefined,
    templateName: marketingCategory ? undefined : input.templateName,
  });
}

export async function evaluateSessionMessageSend(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
}): Promise<{ suppress: boolean }> {
  const flags = await loadContactSendFlags(input.admin, input.businessId, input.phone);
  return { suppress: shouldSuppressSessionMessage(flags.optedOut) };
}

export async function evaluateMarketingLineSessionSend(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  phoneNumberId: string;
  phone: string;
}): Promise<{ suppress: boolean }> {
  const businessId = await lookupBusinessIdForPhoneNumberId(input.admin, input.phoneNumberId);
  if (!businessId) return { suppress: false };
  return evaluateSessionMessageSend({
    admin: input.admin,
    businessId,
    phone: input.phone,
  });
}
