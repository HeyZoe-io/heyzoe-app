import { formatLeadPhoneDisplay } from "@/lib/notifications/owner-email-context";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const PLAN_DO_CRM_FORM_URL = "https://plando.co.il/contacts/crm_form";
/** Required by Plan Do when creating a new activity record (no record_id). */
const PLAN_DO_DEFAULT_RECORD_TYPE_ID = "1";

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

async function loadPlandoIds(
  businessId: number,
  phone: string
): Promise<{ contactId: string | null; recordId: string | null }> {
  const variants = contactPhoneLookupVariants(phone);
  if (!variants.length) return { contactId: null, recordId: null };

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("contacts")
    .select("plando_contact_id, plando_record_id")
    .eq("business_id", businessId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();

  const contactId = String(
    (data as { plando_contact_id?: string | null } | null)?.plando_contact_id ?? ""
  ).trim();
  const recordId = String(
    (data as { plando_record_id?: string | null } | null)?.plando_record_id ?? ""
  ).trim();
  return {
    contactId: contactId || null,
    recordId: recordId || null,
  };
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
  const trimmed = String(rawText ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as PlanDoCrmFormResponse;
  } catch {
    if (trimmed === "1") return { err: "0" };
    return null;
  }
}

/**
 * Plan Do: POST /contacts/crm_form — פעילות CRM (record[description]).
 *
 * Upsert לפי מזהים שמורים ב-contacts:
 * - plando_contact_id → contact_id (אותו ליד, בלי contact כפול)
 * - plando_record_id → record_id (עדכון אותה פעילות)
 *
 * בלי contact_id, Plan Do מנסה להתאים לפי phone; אחרי תגובה ראשונה נשמרים המזהים.
 *
 * לא משתמשים ב-lead_form1 — בבדיקות הוא מחזיר "New contact" בכל קריאה ויוצר כפילויות.
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

  const { contactId: existingContactId, recordId: existingRecordId } = await loadPlandoIds(
    businessId,
    input.phone
  );
  const actualDate = formatPlandoActualDate(input.eventAtIso);

  const params = new URLSearchParams();
  params.set("access_key", accessKey);
  params.set("phone", phoneDisplay);
  params.set("no_redirect", "1");
  params.set("record[actual_date]", actualDate);
  params.set("record[description]", noteText);
  if (existingContactId) params.set("contact_id", existingContactId);
  if (existingRecordId) {
    params.set("record_id", existingRecordId);
  } else {
    params.set("record[record_type_id]", PLAN_DO_DEFAULT_RECORD_TYPE_ID);
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
      console.error("[crm/plan-do] crm_form HTTP error", {
        status: res.status,
        phone: maskPhoneForLog(phoneDisplay),
        body: rawText.slice(0, 500),
      });
      return { ok: false, error: "http_error", detail: `status_${res.status}` };
    }

    if (!parsed || String(parsed.err ?? "") !== "0") {
      console.error("[crm/plan-do] crm_form API error", {
        phone: maskPhoneForLog(phoneDisplay),
        err: parsed?.err,
        errdesc: parsed?.errdesc,
        body: rawText.slice(0, 500),
      });
      return {
        ok: false,
        error: "api_error",
        detail: parsed?.errdesc || parsed?.err || rawText.slice(0, 200),
      };
    }

    await cachePlandoIds({
      businessId,
      phone: input.phone,
      contactId: parsed.contact_id ?? existingContactId,
      recordId: parsed.record_id ?? existingRecordId,
    });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[crm/plan-do] crm_form request failed", {
      phone: maskPhoneForLog(phoneDisplay),
      error: message,
    });
    return { ok: false, error: "request_failed", detail: message };
  }
}
