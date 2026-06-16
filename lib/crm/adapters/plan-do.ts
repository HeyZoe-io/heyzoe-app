import { formatLeadPhoneDisplay } from "@/lib/notifications/owner-email-context";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const PLAN_DO_CRM_FORM_URL = "https://plando.co.il/contacts/crm_form";
const PLAN_DO_LEAD_FORM_URL = "https://plando.co.il/contacts/lead_form1";
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

/** lead_form1 — contact.remark = הערה על כרטיס הליד בפלאן דו. */
async function submitPlanDoLeadRemark(input: {
  apiKey: string;
  phone: string;
  fullName?: string | null;
  noteText: string;
}): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const accessKey = String(input.apiKey ?? "").trim();
  if (!accessKey) return { ok: false, error: "missing_api_key" };

  const phoneDisplay = formatLeadPhoneDisplay(input.phone);
  if (!phoneDisplay || phoneDisplay === "—") return { ok: false, error: "invalid_phone" };

  const noteText = String(input.noteText ?? "").trim();
  if (!noteText) return { ok: false, error: "missing_note" };

  const name = String(input.fullName ?? "").trim() || phoneDisplay;

  try {
    const res = await fetch(PLAN_DO_LEAD_FORM_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_key: accessKey,
        name,
        phone: phoneDisplay,
        email: "",
        no_redirect: 1,
        contact: {
          remark: noteText,
          customer_cat_id: 0,
        },
      }),
    });

    const rawText = await res.text();
    if (!res.ok) {
      console.error("[crm/plan-do] lead_form1 HTTP error", {
        status: res.status,
        phone: maskPhoneForLog(phoneDisplay),
        body: rawText.slice(0, 500),
      });
      return { ok: false, error: "http_error", detail: `status_${res.status}` };
    }

    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[crm/plan-do] lead_form1 request failed", {
      phone: maskPhoneForLog(phoneDisplay),
      error: message,
    });
    return { ok: false, error: "request_failed", detail: message };
  }
}

/**
 * Plan Do: lead_form1 (הערה על הליד) + crm_form (רשומת פעילות).
 * record[description] / contact.remark = noteText מ-buildCrmEventNote.
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

  const remarkResult = await submitPlanDoLeadRemark({
    apiKey: accessKey,
    phone: input.phone,
    fullName: input.fullName,
    noteText,
  });

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
  } else {
    params.set("record[record_type_id]", PLAN_DO_DEFAULT_RECORD_TYPE_ID);
  }

  let activityOk = false;

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
    } else if (!parsed || String(parsed.err ?? "") !== "0") {
      console.error("[crm/plan-do] crm_form API error", {
        phone: maskPhoneForLog(phoneDisplay),
        err: parsed?.err,
        errdesc: parsed?.errdesc,
        body: rawText.slice(0, 500),
      });
    } else {
      await cachePlandoIds({
        businessId,
        phone: input.phone,
        contactId: parsed.contact_id,
        recordId: parsed.record_id,
      });
      activityOk = true;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[crm/plan-do] crm_form request failed", {
      phone: maskPhoneForLog(phoneDisplay),
      error: message,
    });
  }

  if (!remarkResult.ok) {
    console.warn("[crm/plan-do] lead_form1 remark failed", {
      phone: maskPhoneForLog(phoneDisplay),
      error: remarkResult.error,
      detail: remarkResult.detail,
    });
  }

  if (activityOk || remarkResult.ok) return { ok: true };

  return remarkResult;
}
