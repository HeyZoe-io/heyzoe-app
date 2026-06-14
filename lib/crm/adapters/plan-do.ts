import { formatLeadPhoneDisplay } from "@/lib/notifications/owner-email-context";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const PLAN_DO_CRM_FORM_URL = "https://plando.co.il/contacts/crm_form";

type PlanDoCrmFormResponse = {
  err?: string;
  errdesc?: string;
  contact_id?: string;
  record_id?: string;
  status?: number;
  error?: string;
};

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

/** dd/mm/yyyy — Asia/Jerusalem (פורמט record[actual_date] בפלנדו). */
function formatPlandoActualDate(iso?: string): string {
  try {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) throw new Error("invalid_date");
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date());
  }
}

async function loadPlandoRecordId(businessId: number, phone: string): Promise<string | null> {
  const variants = contactPhoneLookupVariants(phone);
  if (!variants.length) return null;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("contacts")
    .select("plando_record_id")
    .eq("business_id", businessId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();

  const id = String((data as { plando_record_id?: string | null } | null)?.plando_record_id ?? "").trim();
  return id || null;
}

async function cachePlandoIds(input: {
  businessId: number;
  phone: string;
  contactId?: string | null;
  recordId?: string | null;
}): Promise<void> {
  const variants = contactPhoneLookupVariants(input.phone);
  if (!variants.length) return;

  const patch: Record<string, string> = {};
  const contactId = String(input.contactId ?? "").trim();
  const recordId = String(input.recordId ?? "").trim();
  if (contactId) patch.plando_contact_id = contactId;
  if (recordId) patch.plando_record_id = recordId;
  if (!Object.keys(patch).length) return;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("contacts")
    .update(patch)
    .eq("business_id", input.businessId)
    .in("phone", variants);

  if (error) {
    console.warn("[crm/plan-do] cache ids failed", {
      businessId: input.businessId,
      phone: maskPhoneForLog(input.phone),
      error: error.message,
    });
  }
}

function parsePlanDoResponse(rawText: string): PlanDoCrmFormResponse | null {
  try {
    return JSON.parse(rawText) as PlanDoCrmFormResponse;
  } catch {
    return null;
  }
}

/**
 * Plan Do crm_form — form-urlencoded.
 * record[description] = noteText מ-buildCrmEventNote (זואי: טמפלייט / ניסיון / לא ענה וכו').
 * Upsert: plando_record_id קיים → record_id (עדכון); אחרת יצירה + שמירת contact_id/record_id.
 */
export async function submitPlanDoLeadEvent(input: {
  businessId: number;
  apiKey: string;
  phone: string;
  fullName?: string | null;
  noteText: string;
  eventAtIso?: string;
}): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const businessId = Number(input.businessId);
  const accessKey = String(input.apiKey ?? "").trim();
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return { ok: false, error: "missing_business_id" };
  }
  if (!accessKey) return { ok: false, error: "missing_api_key" };

  const phoneDisplay = formatLeadPhoneDisplay(input.phone);
  if (!phoneDisplay || phoneDisplay === "—") return { ok: false, error: "invalid_phone" };

  const noteText = String(input.noteText ?? "").trim();
  if (!noteText) return { ok: false, error: "missing_note" };

  const existingRecordId = await loadPlandoRecordId(businessId, input.phone);
  const actualDate = formatPlandoActualDate(input.eventAtIso);

  const params = new URLSearchParams();
  params.set("access_key", accessKey);
  params.set("phone", phoneDisplay);
  params.set("no_redirect", "1");
  params.set("record[actual_date]", actualDate);
  params.set("record[description]", noteText);
  if (existingRecordId) {
    params.set("record_id", existingRecordId);
  }

  try {
    const res = await fetch(PLAN_DO_CRM_FORM_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: params.toString(),
    });

    const rawText = await res.text();
    const parsed = parsePlanDoResponse(rawText);

    if (!res.ok) {
      console.error("[crm/plan-do] HTTP error", {
        status: res.status,
        phone: maskPhoneForLog(phoneDisplay),
        body: rawText.slice(0, 500),
      });
      return { ok: false, error: "http_error", detail: `status_${res.status}` };
    }

    if (!parsed || String(parsed.err ?? "") !== "0") {
      console.error("[crm/plan-do] API error", {
        phone: maskPhoneForLog(phoneDisplay),
        err: parsed?.err,
        errdesc: parsed?.errdesc,
        body: rawText.slice(0, 500),
      });
      return {
        ok: false,
        error: "plando_api_error",
        detail: String(parsed?.errdesc ?? parsed?.error ?? rawText).slice(0, 200),
      };
    }

    await cachePlandoIds({
      businessId,
      phone: input.phone,
      contactId: parsed.contact_id,
      recordId: parsed.record_id,
    });

    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[crm/plan-do] request failed", {
      phone: maskPhoneForLog(phoneDisplay),
      error: message,
    });
    return { ok: false, error: "request_failed", detail: message };
  }
}
