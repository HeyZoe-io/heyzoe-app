/**
 * Database reads behind the plan checks. Every read is a range on an index:
 * whatsapp_templates (business, name), contacts (business, phone), template_triggers (id),
 * wa_template_send_claims (PK), scheduled_template_sends (business, phone, template, event_key),
 * wa_template_send_refs (business, created_at), wa_message_statuses (business, status, status_at).
 * Per PLAN: one template read per (business, template), one contact read per item, one
 * baseline read per business, one WABA read per business. Missing tables or columns read as empty.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { shouldSuppressLeadTemplate } from "@/lib/wa-marketing-opt-out";
import { TEMPLATE_DUPLICATE_WINDOW_MS } from "@/lib/notifications/template-duplicate-guard";
import {
  claimPhoneKey,
  TEMPLATE_SEND_CLAIMS_TABLE,
  templateClaimName,
} from "@/lib/notifications/template-send-claim";
import { LEAVE_REQUEST_WINDOW_MS } from "@/lib/leads/leave-request";
import { israelWallInstant, planDayOf, WABA_BLOCKING_CODES } from "@/lib/send-plan/checks";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const DAY_MS = 24 * 60 * 60 * 1000;

function missingRelation(message: string): boolean {
  return /does not exist|42P01|PGRST205|schema cache|could not find/i.test(message);
}

export type PlanReadCache = {
  templates: Map<string, Promise<{ components: unknown; category: string | null; language: string | null } | null>>;
  triggerTypes: Map<string, Promise<string | null>>;
  waba: Map<number, Promise<{ blocked: boolean; code: number | null }>>;
};

export function emptyPlanReadCache(): PlanReadCache {
  return { templates: new Map(), triggerTypes: new Map(), waba: new Map() };
}

export function loadTemplateMeta(
  admin: Admin,
  cache: PlanReadCache,
  businessId: number,
  templateName: string
): Promise<{ components: unknown; category: string | null; language: string | null } | null> {
  const key = `${businessId}|${templateName}`;
  let hit = cache.templates.get(key);
  if (!hit) {
    hit = (async () => {
      const { data, error } = await admin
        .from("whatsapp_templates")
        .select("components, category, language")
        .eq("business_id", businessId)
        .eq("name", templateName)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("[send-plan] template read failed:", error.message, { businessId, templateName });
        return null;
      }
      if (!data) return null;
      const row = data as { components?: unknown; category?: unknown; language?: unknown };
      return {
        components: row.components ?? null,
        category: row.category ? String(row.category) : null,
        language: row.language ? String(row.language) : null,
      };
    })();
    cache.templates.set(key, hit);
  }
  return hit;
}

export function loadTriggerType(admin: Admin, cache: PlanReadCache, triggerId: string | null): Promise<string | null> {
  const id = String(triggerId ?? "").trim();
  if (!id) return Promise.resolve(null);
  let hit = cache.triggerTypes.get(id);
  if (!hit) {
    hit = (async () => {
      const { data, error } = await admin.from("template_triggers").select("trigger_type").eq("id", id).maybeSingle();
      if (error) {
        console.error("[send-plan] trigger read failed:", error.message, { triggerId: id });
        return null;
      }
      const type = String((data as { trigger_type?: unknown } | null)?.trigger_type ?? "").trim();
      return type || null;
    })();
    cache.triggerTypes.set(id, hit);
  }
  return hit;
}

export type ContactCheck = {
  optedOut: boolean;
  marketingOptedOut: boolean;
  isStaff: boolean;
  leaveRequest: boolean;
};

const CONTACT_SELECTS = [
  "opted_out, marketing_opted_out, arbox_is_staff, leave_request_at",
  "opted_out, marketing_opted_out, arbox_is_staff",
  "opted_out, marketing_opted_out",
  "opted_out",
];

/** null: no contacts row. Throws nothing; a failed read is logged and reads as no row. */
export async function loadContactCheck(
  admin: Admin,
  businessId: number,
  phone: string,
  now: Date
): Promise<ContactCheck | null> {
  const variants = contactPhoneLookupVariants(phone);
  if (!variants.length) return null;
  for (const select of CONTACT_SELECTS) {
    const { data, error } = await admin
      .from("contacts")
      .select(select)
      .eq("business_id", businessId)
      .in("phone", variants)
      .limit(1)
      .maybeSingle();
    if (error) {
      if (/does not exist|42703|schema cache|PGRST204/i.test(error.message)) continue;
      console.error("[send-plan] contact read failed:", error.message, { businessId });
      return null;
    }
    if (!data) return null;
    const row = data as {
      opted_out?: boolean;
      marketing_opted_out?: boolean;
      arbox_is_staff?: boolean;
      leave_request_at?: string | null;
    };
    const leaveAt = row.leave_request_at ? Date.parse(row.leave_request_at) : NaN;
    return {
      optedOut: row.opted_out === true,
      marketingOptedOut: row.marketing_opted_out === true,
      isStaff: row.arbox_is_staff === true,
      leaveRequest: Number.isFinite(leaveAt) && now.getTime() - leaveAt <= LEAVE_REQUEST_WINDOW_MS,
    };
  }
  return null;
}

export function optOutSuppresses(contact: ContactCheck | null, category: string | null): boolean {
  if (!contact) return false;
  return shouldSuppressLeadTemplate({
    category,
    optedOut: contact.optedOut,
    marketingOptedOut: contact.marketingOptedOut,
  });
}

/**
 * Certain duplicate: the same business + phone + template + event already sent or sending
 * (the 20h claim of sendBusinessTemplate), or already planned / held / queued in the queue.
 * `ownDedupKey` is the row being written now and does not count.
 */
export async function findCertainDuplicate(input: {
  admin: Admin;
  businessId: number;
  phone: string;
  templateName: string;
  claimEventKey: string | null;
  queueEventKey: string;
  ownDedupKey?: string | null;
  now: Date;
}): Promise<{ duplicate: boolean; source?: "claim" | "queue" }> {
  const phoneKey = claimPhoneKey(input.phone);
  if (phoneKey) {
    const since = new Date(input.now.getTime() - TEMPLATE_DUPLICATE_WINDOW_MS).toISOString();
    const { data, error } = await input.admin
      .from(TEMPLATE_SEND_CLAIMS_TABLE)
      .select("claimed_at")
      .eq("business_id", input.businessId)
      .eq("phone", phoneKey)
      .eq("template_name", templateClaimName(input.templateName, input.claimEventKey))
      .gte("claimed_at", since)
      .limit(1);
    if (error && !missingRelation(error.message)) {
      console.error("[send-plan] claim read failed:", error.message, { businessId: input.businessId });
    } else if (data?.length) {
      return { duplicate: true, source: "claim" };
    }
  }
  const phone = normalizePhone(input.phone) ?? String(input.phone ?? "").replace(/\D/g, "");
  const { data: rows, error: queueErr } = await input.admin
    .from("scheduled_template_sends")
    .select("dedup_key, status")
    .eq("business_id", input.businessId)
    .eq("contact_phone", phone)
    .eq("template_name", input.templateName)
    .eq("event_key", input.queueEventKey)
    .in("status", ["planned", "held", "pending", "sending", "sent", "unknown"])
    .limit(5);
  if (queueErr) {
    if (!/event_key/i.test(queueErr.message)) {
      console.error("[send-plan] queue duplicate read failed:", queueErr.message, { businessId: input.businessId });
    }
    return { duplicate: false };
  }
  const other = (rows ?? []).some(
    (row) => String((row as { dedup_key?: unknown }).dedup_key ?? "") !== String(input.ownDedupKey ?? "")
  );
  return other ? { duplicate: true, source: "queue" } : { duplicate: false };
}

/**
 * A business-blocking Meta error (payment, lock, disconnected number) in the last 24h
 * with no delivered / read status after it.
 */
export function loadWabaBlocked(
  admin: Admin,
  cache: PlanReadCache,
  businessId: number,
  now: Date
): Promise<{ blocked: boolean; code: number | null }> {
  let hit = cache.waba.get(businessId);
  if (!hit) {
    hit = readWabaBlocked(admin, businessId, now);
    cache.waba.set(businessId, hit);
  }
  return hit;
}

async function readWabaBlocked(
  admin: Admin,
  businessId: number,
  now: Date
): Promise<{ blocked: boolean; code: number | null }> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  let lastAt: string | null = null;
  let code: number | null = null;
  const { data: statuses, error } = await admin
    .from("wa_message_statuses")
    .select("error_code, status_at")
    .eq("business_id", businessId)
    .eq("status", "failed")
    .in("error_code", [...WABA_BLOCKING_CODES])
    .gte("status_at", since)
    .order("status_at", { ascending: false })
    .limit(1);
  if (error && !missingRelation(error.message)) {
    console.error("[send-plan] waba status read failed:", error.message, { businessId });
  }
  const s = statuses?.[0] as { error_code?: unknown; status_at?: unknown } | undefined;
  if (s?.status_at) {
    lastAt = String(s.status_at);
    code = Number(s.error_code) || null;
  }
  const { data: failures, error: failErr } = await admin
    .from("template_send_failures")
    .select("meta_code, created_at")
    .eq("business_id", businessId)
    .in("meta_code", WABA_BLOCKING_CODES.map(String))
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (failErr && !missingRelation(failErr.message)) {
    console.error("[send-plan] waba failure read failed:", failErr.message, { businessId });
  }
  const f = failures?.[0] as { meta_code?: unknown; created_at?: unknown } | undefined;
  if (f?.created_at && (!lastAt || String(f.created_at) > lastAt)) {
    lastAt = String(f.created_at);
    code = Number(f.meta_code) || null;
  }
  if (!lastAt) return { blocked: false, code: null };
  const { data: delivered, error: delErr } = await admin
    .from("wa_message_statuses")
    .select("status_at")
    .eq("business_id", businessId)
    .in("status", ["delivered", "read"])
    .gt("status_at", lastAt)
    .limit(1);
  if (delErr && !missingRelation(delErr.message)) {
    console.error("[send-plan] waba delivered read failed:", delErr.message, { businessId });
  }
  if (delivered?.length) return { blocked: false, code: null };
  return { blocked: true, code };
}

/** Automated sends of the 14 days before today (wa_template_send_refs). */
export async function loadSendHistory(
  admin: Admin,
  businessId: number,
  now: Date,
  triggerId?: string | null
): Promise<{ ok: boolean; rows: Array<{ trigger_id: string | null; created_at: string }> }> {
  const until = israelWallInstant(planDayOf(now), "00:00") ?? new Date(now.getTime() - (now.getTime() % DAY_MS));
  const since = new Date(until.getTime() - 14 * DAY_MS).toISOString();
  let query = admin
    .from("wa_template_send_refs")
    .select("trigger_id, created_at")
    .eq("business_id", businessId)
    .gte("created_at", since)
    .lt("created_at", until.toISOString());
  if (triggerId) query = query.eq("trigger_id", triggerId);
  const { data, error } = await query.limit(20000);
  if (error) {
    if (!missingRelation(error.message)) {
      console.error("[send-plan] send history read failed:", error.message, { businessId });
    }
    return { ok: false, rows: [] };
  }
  return {
    ok: true,
    rows: (data ?? []).map((row) => ({
      trigger_id: (row as { trigger_id?: string | null }).trigger_id ?? null,
      created_at: String((row as { created_at?: unknown }).created_at ?? ""),
    })),
  };
}

export async function countSendsSince(
  admin: Admin,
  businessId: number,
  triggerId: string,
  since: Date
): Promise<number | null> {
  const { count, error } = await admin
    .from("wa_template_send_refs")
    .select("wamid", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("trigger_id", triggerId)
    .gte("created_at", since.toISOString());
  if (error) {
    if (!missingRelation(error.message)) console.error("[send-plan] hourly count failed:", error.message);
    return null;
  }
  return count ?? 0;
}
