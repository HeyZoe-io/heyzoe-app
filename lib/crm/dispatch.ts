import { submitPlanDoLeadEvent } from "@/lib/crm/adapters/plan-do";
import { buildCrmEventNote, normalizeCrmType, type CrmEventKind } from "@/lib/crm/types";
import { formatDateDdMmYyyy } from "@/lib/email";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

function formatEventDateIl(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return formatDateDdMmYyyy(iso);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return formatDateDdMmYyyy(iso);
  }
}

async function resolveLeadFullName(input: {
  businessId: number;
  leadPhone: string;
  fullName?: string | null;
}): Promise<string | null> {
  const preset = String(input.fullName ?? "").trim();
  if (preset) return preset;

  const admin = createSupabaseAdminClient();
  const variants = contactPhoneLookupVariants(input.leadPhone);
  if (!variants.length) return null;

  const { data } = await admin
    .from("contacts")
    .select("full_name")
    .eq("business_id", input.businessId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();

  const name = String((data as { full_name?: string | null } | null)?.full_name ?? "").trim();
  return name || null;
}

/**
 * שולח אירוע CRM לפי הגדרות העסק (crm_type + crm_api_key).
 * לא זורק — רושם שגיאות ללוג.
 */
export async function dispatchCrmEvent(input: {
  businessId: number;
  leadPhone: string;
  kind: CrmEventKind;
  fullName?: string | null;
  eventAtIso?: string;
}): Promise<void> {
  const businessId = Number(input.businessId);
  const leadPhone = String(input.leadPhone ?? "").trim();
  if (!businessId || !leadPhone) return;

  try {
    const admin = createSupabaseAdminClient();
    const { data: business, error } = await admin
      .from("businesses")
      .select("crm_type, crm_api_key")
      .eq("id", businessId)
      .maybeSingle();

    if (error) {
      console.error("[crm/dispatch] business load failed", { businessId, error: error.message });
      return;
    }

    const crmType = normalizeCrmType((business as { crm_type?: unknown } | null)?.crm_type);
    const apiKey = String((business as { crm_api_key?: unknown } | null)?.crm_api_key ?? "").trim();
    if (!crmType || !apiKey) return;

    const eventAtIso = String(input.eventAtIso ?? new Date().toISOString()).trim();
    const noteText = buildCrmEventNote(input.kind, formatEventDateIl(eventAtIso));
    const fullName = await resolveLeadFullName({
      businessId,
      leadPhone,
      fullName: input.fullName,
    });

    if (crmType === "plan_do") {
      const result = await submitPlanDoLeadEvent({
        apiKey,
        phone: leadPhone,
        fullName,
        noteText,
      });
      if (!result.ok) {
        console.error("[crm/dispatch] plan_do failed", {
          businessId,
          kind: input.kind,
          phone: maskPhoneForLog(leadPhone),
          error: result.error,
          detail: result.detail,
        });
      }
      return;
    }

    console.warn("[crm/dispatch] adapter not implemented", { businessId, crmType, kind: input.kind });
  } catch (e) {
    console.error("[crm/dispatch] unexpected error", {
      businessId: input.businessId,
      kind: input.kind,
      phone: maskPhoneForLog(input.leadPhone),
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
